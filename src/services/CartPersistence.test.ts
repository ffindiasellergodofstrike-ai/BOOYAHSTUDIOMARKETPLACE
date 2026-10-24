import test from 'node:test';
import assert from 'node:assert/strict';
test('guest cart survives session verification; sign-in merges it without duplicate quantities', async () => {
 const saved=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>saved.get(k)||null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)},configurable:true});
 const original=globalThis.fetch;
 let loggedIn=false;
 globalThis.fetch=async(input:any)=>{
  if(String(input)==='/api/auth/login'){loggedIn=true;return Response.json({success:true,user:{id:'alice',email:'alice@example.com'}});}
  if(String(input)==='/api/auth/logout')return Response.json({success:true});
  if(String(input)==='/api/user/cart')return Response.json({success:true,items:[]});
  return Response.json({success:false},{status:401});
 };
 try {
  const {PRODUCTS}=await import('../data/products');
  saved.set('booyah-studio_cart_v1',JSON.stringify([{product:PRODUCTS[0],price:PRODUCTS[0].price,quantity:1}]));
  const {CartService}=await import('./CartService');
  const {AuthService}=await import('./AuthService');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(CartService.getItemCount(),1);
  await AuthService.verifySession();
  assert.equal(CartService.getItemCount(),1,'unauthenticated refresh must preserve a guest cart');
  CartService.addItem(PRODUCTS[0],4);assert.equal(CartService.getItemCount(),1);
  await AuthService.signIn('alice@example.com','synthetic-password');await new Promise(r=>setTimeout(r,20));
  assert.equal(loggedIn,true);assert.equal(CartService.getItemCount(),1,'guest cart must merge after login');
  await AuthService.signOut();assert.equal(CartService.getItemCount(),0,'private cart must clear at logout');
 } finally {globalThis.fetch=original;}
});
