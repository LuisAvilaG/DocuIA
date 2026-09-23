import test, { mock } from "node:test";
import https from "node:https";
import dns from "node:dns/promises";
import { createCipheriv, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { NextRequest } from "next/server";
import { isPrivateIp, resolvePublicHttpsUrl, postPublicWebhook } from "../lib/webhooks/ssrf";
import { canAccessTenantArea } from "../lib/auth/permissions";
import { accessPayloadSchema, refreshPayloadSchema } from "../lib/auth/token-payload";
import { clientIp } from "../lib/security/request-ip";
import { isSameOriginMutation, readBoundedBody, withApiSecurity } from "../lib/security/http";
import { sanitizeContractHtml } from "../lib/security/html";
import { safeReturnPath } from "../lib/security/return-path";
import { isOrgWordTemplateKey } from "../lib/security/storage-key";
import { signUploadReceipt, verifyUploadReceipt } from "../lib/security/upload-receipt";
import { matchesFileType } from "../lib/security/files";
import { validateDocx } from "../lib/security/docx";
import { buildRestApiUrl, buildRestletUrl } from "../lib/netsuite/oauth";
import { passwordSchema } from "../lib/auth/input";
import { decryptField, encryptField } from "../lib/crypto/encrypt";

process.env.JWT_SECRET = "test-only-".repeat(8);
process.env.ENCRYPTION_KEY = "a".repeat(64);
process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
const org = "10000000-0000-4000-8000-000000000001";
const user = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";

test("JWT token purposes are not interchangeable even with the same signing key", () => {
  const refresh = { sub: user, type: "platform_admin", sessionId, tokenUse: "refresh", tokenNonce: "a".repeat(64) };
  assert.equal(refreshPayloadSchema.safeParse(refresh).success, true);
  assert.equal(accessPayloadSchema.safeParse(refresh).success, false);
  assert.equal(accessPayloadSchema.safeParse({ ...refresh, tokenUse: "access", email: "test@example.com" }).success, true);
  assert.equal(accessPayloadSchema.safeParse({ sub: user, type: "platform_admin", email: "test@example.com" }).success, false);
});
test("roles and API scopes enforce least privilege", () => {
  assert.equal(canAccessTenantArea("viewer", { permission: "write" }), false);
  assert.equal(canAccessTenantArea("viewer", { area: "documents" }), true);
  assert.equal(canAccessTenantArea("expense_submitter", { area: "contracts" }), false);
  assert.equal(canAccessTenantArea("expense_submitter", { area: "expenses", permission: "write" }), true);
  assert.equal(canAccessTenantArea("api_key", {}, []), false);
  assert.equal(canAccessTenantArea("api_key", {}, ["documents:read"]), true);
  assert.equal(canAccessTenantArea("api_key", { permission: "write" }, ["documents:read"]), false);
  assert.equal(canAccessTenantArea("api_key", { area: "settings" }, ["documents:write"]), false);
});
test("IP spoofing cannot use the untrusted leftmost header or localhost bypass", () => {
  process.env.TRUSTED_PROXY_HOPS = "0";
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "127.0.0.1" })), "unknown");
  process.env.TRUSTED_PROXY_HOPS = "1";
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "127.0.0.1, 8.8.8.8" })), "8.8.8.8");
  assert.equal(clientIp(new Headers({ "x-real-ip": "127.0.0.1" })), "unknown");
});
test("CSRF rejects other origins, same-site sibling domains, and originless ambient cookies", async () => {
  const req = (headers: Record<string,string>) => new Request("https://app.example/api/v1/auth/login", { method: "POST", headers });
  assert.equal(isSameOriginMutation(req({ origin: "https://evil.example", "sec-fetch-site": "same-site" }), "https://app.example"), false);
  assert.equal(isSameOriginMutation(req({ cookie: "access_token=test" }), "https://app.example"), false);
  assert.equal(isSameOriginMutation(req({ origin: "https://app.example" }), "https://app.example"), true);
  assert.equal(isSameOriginMutation(req({ authorization: "Bearer test" }), "https://app.example"), true);
  let invoked = false;
  const handler = withApiSecurity(async () => { invoked = true; return Response.json({ok:true}); });
  const res = await handler(new NextRequest(req({ origin: "https://evil.example" })));
  assert.equal(res.status, 403); assert.equal(invoked, false);
});
test("body limits apply to actual streamed bytes without Content-Length", async () => {
  const req = new Request("http://localhost", { method: "POST", body: "x".repeat(100) });
  await assert.rejects(readBoundedBody(req, 50));
  assert.equal((await readBoundedBody(new Request("http://localhost", {method:"POST",body:"ok"}),10)).length, 2);
});
test("bounded route bodies preserve method, headers and JSON for legitimate requests", async () => {
  const handler = withApiSecurity(async req => Response.json({ method:req.method, payload:await req.json(), custom:req.headers.get("x-test") }));
  const response = await handler(new NextRequest("https://app.example/api/v1/auth/login", {method:"POST",body:JSON.stringify({ok:true}),headers:{origin:"https://app.example","content-type":"application/json","x-test":"kept"}}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{method:"POST",payload:{ok:true},custom:"kept"});
});
test("slow request bodies time out", async () => {
  const req = new Request("http://localhost", {method:"POST",body:new ReadableStream({start(){}}),duplex:"half"} as RequestInit);
  await assert.rejects(readBoundedBody(req, 50, 15));
});
test("SSRF blocks private/reserved IPv4 and alternative IPv6 encodings", async () => {
  for(const ip of ["127.0.0.1","169.254.169.254","10.1.2.3","100.64.1.1","224.0.0.1","::ffff:7f00:1","::ffff:127.0.0.1","febf::1","fc00::1","64:ff9b::7f00:1","2002:7f00:1::","::1"]) assert.equal(isPrivateIp(ip),true,ip);
  for(const ip of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"]) assert.equal(isPrivateIp(ip),false,ip);
  for(const url of ["https://2130706433/","https://0x7f000001/","https://[::ffff:7f00:1]/","https://8.8.8.8:8443/","https://user:pass@8.8.8.8/"]) await assert.rejects(resolvePublicHttpsUrl(url));
});
test("HTML keeps formatting while eliminating active content, CSS URLs, remote assets and SVG", () => {
  const clean = sanitizeContractHtml('<h1>Contrato</h1><p style="text-align:center;color:#ff0000;background-image:url(https://evil.example)">OK</p><script>alert(1)</script><img src="x" onerror="alert(2)"><svg onload="alert(3)"></svg><iframe srcdoc="attack"></iframe><a href="javascript:alert(4)">link</a>');
  assert.match(clean, /<h1>Contrato<\/h1>/);
  assert.match(clean, /text-align:center/);
  assert.doesNotMatch(clean, /script|onerror|onload|iframe|svg|background-image|javascript:|evil\.example/);
});
test("webhook connections use the checked DNS address and never follow a redirect", async () => {
  let resolutions=0,connections=0;
  const lookupMock=mock.method(dns,"lookup",async()=>{resolutions++;return [{address:"1.1.1.1",family:4}];});
  const requestMock=mock.method(https,"request",(_url: unknown, options: RequestOptions, callback: (res: IncomingMessage)=>void)=>{
    connections++;
    assert.ok(options.lookup);
    options.lookup("hook.example", {all:false}, (error, address)=>{assert.equal(error,null);assert.equal(address,"1.1.1.1");});
    const emitter=new EventEmitter();
    return Object.assign(emitter,{
      end(){ queueMicrotask(()=>callback({statusCode:302,headers:{location:"https://169.254.169.254/"},destroy(){emitter.emit("close");}} as unknown as IncomingMessage)); },
      destroy(){emitter.emit("close");},
    }) as ClientRequest;
  });
  try { assert.equal(await postPublicWebhook("https://hook.example/", "{}", {}),302);assert.equal(resolutions,1);assert.equal(connections,1); }
  finally {lookupMock.mock.restore();requestMock.mock.restore();}
});
test("Word storage ownership and expense upload proofs prevent cross-tenant file references", () => {
  assert.equal(isOrgWordTemplateKey(`contracts/${org}/flows/flow/word-templates/document.docx`,org),true);
  assert.equal(isOrgWordTemplateKey('contracts/other/flows/flow/word-templates/document.docx',org),false);
  assert.equal(isOrgWordTemplateKey(`contracts/${org}/flows/../word-templates/a`,org),false);
  const receipt=signUploadReceipt({orgId:org,userId:user,fileKey:'expenses/test.pdf',mimeType:'application/pdf',originalName:'test.pdf'});
  assert.ok(verifyUploadReceipt(receipt,org,user,'expenses/test.pdf'));
  assert.equal(verifyUploadReceipt(receipt,'other',user,'expenses/test.pdf'),null);
  assert.equal(verifyUploadReceipt(receipt,org,'other','expenses/test.pdf'),null);
  assert.equal(verifyUploadReceipt(receipt,org,user,'expenses/stolen.pdf'),null);
  assert.equal(verifyUploadReceipt(receipt+'x',org,user,'expenses/test.pdf'),null);
});
test("redirect and NetSuite URL builders reject attacker-controlled hosts", () => {
  for(const value of ['//evil.example','/\\evil.example','javascript:alert(1)','/login','/\n/evil.example']) assert.equal(safeReturnPath(value),null);
  assert.equal(safeReturnPath('/contracts/123?tab=docs'),'/contracts/123?tab=docs');
  for(const account of ['evil.example/','127.0.0.1#','x@evil.example','x?y']) assert.throws(()=>buildRestApiUrl(account));
  const url=new URL(buildRestletUrl('123456_SB1','1&evil=true','1'));
  assert.equal(url.hostname,'123456-sb1.restlets.api.netsuite.com');
  assert.equal(url.searchParams.has('evil'),false);
});
test("spoofed MIME and XML entities are rejected; PDF and normal XML accepted", () => {
  assert.equal(matchesFileType(Buffer.from('<script>alert(1)</script>'),'application/pdf'),false);
  assert.equal(matchesFileType(Buffer.from('%PDF-1.7\n'),'application/pdf'),true);
  assert.equal(matchesFileType(Buffer.from('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x/>'),'application/xml'),false);
  assert.equal(matchesFileType(Buffer.from('<?xml version="1.0"?><root/>'),'application/xml'),true);
});
function word(extra?: [string,string]) { const zip=new PizZip(); zip.file('[Content_Types].xml','<Types/>'); zip.file('word/document.xml','<w:document><w:p><w:t>Hola</w:t></w:p></w:document>'); if(extra) zip.file(...extra); return zip.generate({type:'nodebuffer',compression:'DEFLATE'}); }
test("DOCX validation accepts basic templates and rejects active content and ZIP bombs", async () => {
  await validateDocx(word());
  await assert.rejects(validateDocx(word(['word/vbaProject.bin','macro'])));
  await assert.rejects(validateDocx(word(['word/_rels/document.xml.rels','<Relationship TargetMode="Ext&#101;rnal" Target="file:///secret"/>'])));
  await assert.rejects(validateDocx(word(['word/document.xml','<w:instrText>INCLUDETEXT file:///secret</w:instrText>'])));
  await assert.rejects(validateDocx(word(['word/huge.xml','x'.repeat(21*1024*1024)])));
});
test("bcrypt passwords have byte-length limits, including Unicode", () => {
  assert.equal(passwordSchema.safeParse('strong-password').success,true);
  assert.equal(passwordSchema.safeParse('é'.repeat(40)).success,false);
  assert.equal(passwordSchema.safeParse('x'.repeat(73)).success,false);
});
test("AES-GCM encrypted fields require the issued IV and 128-bit authentication tag", () => {
  const encrypted = encryptField("NetSuite credential");
  assert.equal(decryptField(encrypted), "NetSuite credential");
  const [iv, tag, data] = encrypted.slice(4).split(":");
  assert.throws(() => decryptField(`enc:${iv}:${tag.slice(0, -4)}:${data}`), /Invalid encrypted field format/);
  assert.throws(() => decryptField(`enc:not-base64:${tag}:${data}`), /Invalid encrypted field format/);
});
test("AES-GCM fields encrypted before tag hardening remain readable", () => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from("a".repeat(64), "hex"), iv);
  const data = Buffer.concat([cipher.update("existing credential", "utf8"), cipher.final()]);
  const legacy = `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
  assert.equal(decryptField(legacy), "existing credential");
});
