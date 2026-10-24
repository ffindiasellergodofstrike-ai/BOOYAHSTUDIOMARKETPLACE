import crypto from 'node:crypto';
import { Resend } from 'resend';
import { FirebaseRtdb as DB } from './firebaseRtdb';
import { AuthServiceServer } from './auth';
import { atomicDocument } from './atomicStore';
const hash=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
export async function requestPasswordRecovery(email:unknown) {
 if(typeof email!=='string'||email.length>254||!email.includes('@'))return;
 const userId=await DB.findUserIdByIdentifier(email.trim().toLowerCase());if(!userId)return;
 const profile=await DB.getUserProfile(userId);if(profile?.email?.toLowerCase()!==email.trim().toLowerCase())return;
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)throw new Error('Email service unavailable');
 const base=new URL(process.env.APP_URL||'http://localhost:3000');
 if(process.env.NODE_ENV==='production'&&base.protocol!=='https:')throw new Error('HTTPS application URL required');
 const token=crypto.randomBytes(32).toString('hex');const digest=hash(token);
 await DB.set(`password_recovery/${digest}`,{userId,expiresAt:Date.now()+20*60*1000,used:false});
 // Fragment keeps the token out of server access logs and Referer headers.
 const url=`${base.origin}/forgot-password#token=${token}`;
 const result=await new Resend(process.env.RESEND_API_KEY).emails.send({from:process.env.RESEND_FROM_EMAIL,to:profile.email,subject:'Reset your BOOYAH STUDIO password',text:`Open this single-use link within 20 minutes to reset your password:\n${url}\n\nIf you did not request this, ignore this email. Never share this link.`});
 if(result.error){await DB.delete(`password_recovery/${digest}`);throw new Error('Email delivery unavailable');}
}
export async function completePasswordRecovery(token:unknown,password:unknown) {
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>72)throw new Error('Use a valid reset link and a password of 12–72 characters.');
 const passwordHash=await AuthServiceServer.hashPassword(password);
 const recovery=await atomicDocument<any>('password_recovery',hash(token),current=>{if(!current||current.used||current.expiresAt<Date.now())throw new Error('Reset link has expired or has already been used.');return {...current,used:true};});
 await DB.setMultiple({[`users/${recovery.userId}/credentials/passwordHash`]:passwordHash,[`users/${recovery.userId}/profile/sessionValidAfter`]:Date.now()});
}
