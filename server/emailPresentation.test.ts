import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderOrderEmailHtml } from './emailPresentation';

const order={id:'BS-presentation',orderNumber:'ORDER-123',transactionId:'pay_123',paymentProvider:'Cashfree',currency:'INR',total:1499,items:[{productId:'template',productTitle:'Studio template'}]};

test('branded order HTML escapes order content and links only to the account rather than private files',()=>{
 const html=renderOrderEmailHtml({...order,orderNumber:'<script>unsafe</script>',transactionId:'ref" onclick="bad',items:[{productTitle:'<img src=x onerror=alert(1)> & "title"'}],signedUrl:'https://private.invalid/file.zip?token=secret'},false,'https://store.example.test');
 assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;title&quot;/);
 assert.doesNotMatch(html,/<script>|<img|href="javascript:|private\.invalid|token=secret/);
 assert.match(html,/href="https:\/\/store.example.test\/account\/downloads"/);assert.match(html,/INR 1499\.00/);assert.match(html,/Download your files/);
});

test('refund presentation reports the confirmed amount without claiming every download was revoked',()=>{
 const html=renderOrderEmailHtml({...order,refundedAmount:100,items:[{productTitle:'First',refunded:true},{productTitle:'Second'}]},true,'https://store.example.test');
 assert.match(html,/href="https:\/\/store.example.test\/account\/orders"/);
 assert.match(html,/Your refund is confirmed/);assert.match(html,/INR 100\.00/);assert.match(html,/which products remain available/);
 assert.match(html,/Refunded · further downloads restricted/);assert.match(html,/Second/);assert.doesNotMatch(html,/all downloads.*revoked/i);
});

test('copy-ready account templates preserve the working Supabase links and load no remote assets',()=>{
 const signup=readFileSync(new URL('../docs/email-templates/confirm-signup.html',import.meta.url),'utf8');
 const reset=readFileSync(new URL('../docs/email-templates/reset-password.html',import.meta.url),'utf8');
 assert.match(signup,/href="\{\{ \.ConfirmationURL \}\}"/);
 assert.match(reset,/href="\{\{ \.RedirectTo \}\}\?token_hash=\{\{ \.TokenHash \}\}"/);
 for(const html of [signup,reset]){assert.match(html,/name="viewport"/);assert.doesNotMatch(html,/<script|<img|<link|Customer Portal|Supabase authentication/);}
});
