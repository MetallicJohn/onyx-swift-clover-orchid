import { r as createServerFn } from "./ssr.mjs";
import { t as authMiddleware } from "./middleware-Cu1DSXn0.mjs";
import { n as createSsrRpc } from "./router-BJW9Pjuo.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-more-C5Y0MTly.js
var assignOpenTicket = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("8189f346456057568a37dde47fdf2a26d0c291ad3b07ca011b3e642c4eddade6"));
var commentOpenTicket = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("6cc57261e98985e29d9ad06b62b90ee399d17f030af756dabfcb1fc62758ae07"));
var listTicketStaff = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("5f9cf45bb6f1e783c44c9b2bf8ae0c24895b7f5c3c9dd273d115216220cbbd59"));
var queueCpeTask = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("48a0e790a8d1ae7d3d96adf83377a4c29339af9348cfbbe18dd818d8f19c6cd4"));
var listCpeTasks = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("a4276df6051847507687b2c60b80786fcb29007a418aed8bf97a7793326fe460"));
var redeemPoints = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("f191e0976790b49a0f7b7d9c0bb41868d24dacf683d4bbea75bdf81b4568538a"));
var linkReseller = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("3b65fa76427794bb9db6711fd25b659a0e5b0ecc27036dacb059f0d7a236dc44"));
var getPlan = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("8e1392816efb0d87ed30324df30d5fde33bbb12011442e0e1c4bc495f53c00c3"));
var setPlan = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("65ffed348c746e4fa38b133584e47a6a978e2f30a88da4619948de0699a612ed"));
var recordPlanPayment = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("78778dc6f040cb781915956ffc448402fb71db00bbedd78e601ef7e78e6d1540"));
var sendPlanStk = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("7a3ed4d70dd42c8971f07ea7d475b02f46118d1ca553da1a080f150da6061b47"));
var askRouterOs = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("b8cdd856e4723bd8691e891996a289b24615758ae420af7b40146abda15964ac"));
var getReports = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("434b7e52924a49ba3d2c02bf57e5bf1795c736f54b2d161bbd9ff232e34c4bea"));
var getAuditLog = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("dd66a2f2e88a97fde4c7bc456d49abbf04aebacbae551f33b6db26c17eeab899"));
var getStatement = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("c1f8f6abd400cff69c71744e2921567e8c2f3b9709fbd9168556069264c948e0"));
createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("4f0b05ba56a0dcde26445f41ef827f51f0fa6dd880c08857a010fb893d90746b"));
createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("e2fe93fbeec90c7b90207fcb5f255ccbf30aae4915fe179d00bddd42186899e8"));
createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("f343a29b60bea3cb975580feb1062e80abbf518b4cb5c670f5ade0de000536ba"));
var createStaffAccount = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("bcb442d75d8d4c0de9feb0b2de64ac86f75fc24881de015b22754c94211bdf86"));
var platformStatus = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("39d80ed4b6e680362a6b0ddb220628cd592bae56116a4bfe15c30944622089d0"));
var listPlatformTenants = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("d9ccbd4f5a0898071d3ab80984bcb61c7b2a00b209d5be98fb6e08e98e1e05df"));
var createIspAsAdmin = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("e7e284ff2420e2291330090fd2754623ea0c40c1b4ceffcaf98716e174a022f2"));
var changeMemberRole = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("22bcb5c3d5edf5875466ea542ef918f35683ee50e646baceb4461db13efc758c"));
//#endregion
export { recordPlanPayment as _, createIspAsAdmin as a, setPlan as b, getPlan as c, linkReseller as d, listCpeTasks as f, queueCpeTask as g, platformStatus as h, commentOpenTicket as i, getReports as l, listTicketStaff as m, assignOpenTicket as n, createStaffAccount as o, listPlatformTenants as p, changeMemberRole as r, getAuditLog as s, askRouterOs as t, getStatement as u, redeemPoints as v, sendPlanStk as y };
