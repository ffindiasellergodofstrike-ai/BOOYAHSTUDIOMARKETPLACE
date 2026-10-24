import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminService, AdminApiError } from './AdminService';

test('admin API client exposes denied/expired/deployment errors instead of silent empty records',async context=>{
 let reply:Response|Error=Response.json({success:false,message:'Session expired'},{status:401});
 context.mock.method(globalThis,'fetch',async()=>{if(reply instanceof Error)throw reply;return reply.clone();});
 let auth=await AdminService.verifyAdminMe();assert.equal(auth.httpStatus,401);assert.equal(auth.success,false);
 await assert.rejects(AdminService.getOrders(),(error:any)=>error instanceof AdminApiError&&error.httpStatus===401);
 reply=new Response('<html>Deployment failed</html>',{status:502});
 await assert.rejects(AdminService.getProducts(),/unexpected response/);
 reply=new Error('network');auth=await AdminService.verifyAdminMe();assert.equal(auth.httpStatus,0);assert.equal(auth.success,false);
 reply=Response.json({success:true,orders:[]});assert.deepEqual(await AdminService.getOrders(),[]);
});

test('product actions preserve their API binding when passed as React callbacks',async context=>{
 const calls:any[]=[];
 context.mock.method(globalThis,'fetch',async(path:any,options:any)=>{calls.push({path,options});return Response.json({success:true});});
 const {saveProduct,deleteProduct,cloneProduct}=AdminService;
 await saveProduct({id:'item',isNew:true});await deleteProduct('item');await cloneProduct('item');
 assert.equal(calls[0].path,'/api/admin/products');assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[1].options.method,'DELETE');assert.equal(calls[2].path,'/api/admin/products/item/clone');
 assert.ok(calls.every(call=>call.options.credentials==='include'));
});
