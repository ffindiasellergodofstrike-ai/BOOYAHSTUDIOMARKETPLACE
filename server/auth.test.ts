import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { AuthServiceServer } from './auth';
import { FirebaseRtdb } from './firebaseRtdb';
import { completePasswordRecovery } from './passwordRecovery';
test('knowing email and mobile cannot reset a password',async()=>{assert.equal((await AuthServiceServer.resetPasswordWithEmailAndMobile({email:'buyer@example.test',mobile:'9876543210',newPassword:'new-secret-password',confirmNewPassword:'new-secret-password'})).success,false);});
test('old sessions are rejected after password reset',async t=>{t.mock.method(FirebaseRtdb,'get',async()=>({userId:'buyer',createdAt:'2026-09-20T00:00:00Z',expiresAt:Date.now()+60000}));t.mock.method(FirebaseRtdb,'getUserProfile',async()=>({sessionValidAfter:Date.now()}));assert.equal(await AuthServiceServer.verifyOpaqueSession('synthetic-session'),null);});
test('single-use reset token atomically revokes sessions and updates password; replay/expiry rejected',async t=>{
 const token='a'.repeat(64),digest=crypto.createHash('sha256').update(token).digest('hex');let record:any={userId:'buyer',used:false,expiresAt:Date.now()+60000};let writes:any;
 t.mock.method(FirebaseRtdb,'get',async(path:string)=>{assert.equal(path,`password_recovery/${digest}`);return structuredClone(record);});t.mock.method(FirebaseRtdb,'set',async(_path:string,value:any)=>{record=value;});t.mock.method(FirebaseRtdb,'setMultiple',async(value:any)=>{writes=value;});
 await completePasswordRecovery(token,'new-secret-password');assert.equal(record.used,true);assert.ok(writes['users/buyer/profile/sessionValidAfter']);assert.ok(await AuthServiceServer.verifyPassword('new-secret-password',writes['users/buyer/credentials/passwordHash']));await assert.rejects(completePasswordRecovery(token,'another-password'));record={userId:'buyer',used:false,expiresAt:Date.now()-1};await assert.rejects(completePasswordRecovery(token,'another-password'));assert.equal(record.used,false);
});
