import test from 'node:test';
import assert from 'node:assert/strict';

test('browser profile cache never authenticates a customer and network failure clears verified UI state', async () => {
 const values=new Map<string,string>([['booyah-studio_auth_user_v1',JSON.stringify({id:'forged',role:'admin'})]]);
 const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const originalFetch=globalThis.fetch;
 const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),clear:()=>values.clear(),key:(index:number)=>[...values.keys()][index]||null,get length(){return values.size;}};
 Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
 let resolveInitial!:(value:Response)=>void;const initial=new Promise<Response>(resolve=>{resolveInitial=resolve;});let call=0;
 globalThis.fetch=async()=>{call++;if(call===1)return initial;return Response.json({success:true,user:{id:'verified',email:'buyer@example.test',role:'customer'}});};
 try {
  const {AuthService}=await import('./AuthService');
  assert.equal(AuthService.getCurrentUser(),null);assert.equal(AuthService.isAuthenticated(),false);assert.equal(values.has('booyah-studio_auth_user_v1'),false);
  resolveInitial(Response.json({success:false},{status:401}));
  await new Promise(resolve=>setTimeout(resolve,0));
  await AuthService.verifySession();assert.equal(AuthService.getCurrentUser()?.id,'verified');
  globalThis.fetch=async()=>{throw new Error('offline');};
  await AuthService.verifySession();assert.equal(AuthService.isAuthenticated(),false);assert.equal(AuthService.getCurrentUser(),null);
 } finally {globalThis.fetch=originalFetch;if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete (globalThis as any).localStorage;}
});
