import { r as createServerFn } from "./ssr.mjs";
import { t as authMiddleware } from "./middleware-BuXiR3_1.mjs";
import { n as createSsrRpc } from "./router-CtSkafEx.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-mikrotik-CcoJ4Q0v.js
var getRouterApi = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("2c7d38a323f7060a64084bb37c50743b4eacce5a84b2ef1d83801a66ed1bae2f"));
var saveRouterApi = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("17c9a3fe57a18486bd60f5036522922767e22f7d861f22899deb3a17576e1220"));
var queueRouterCommand = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("3cd2cda27fc0b96acc2e818b8b8fa5942d8cdf01fcc5916eeaec565b1a53bcb2"));
var approveRouterCommand = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("ba96a44f28cb314113fd2de99355278a9e4682505f11c38fb1fbe6d5e019b2b2"));
var previewRouterCommand = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("3827f211bbd82335627e9c0710c0cf44850078235f38fff50f2902091fb86b86"));
var runRouterApi = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("c8c89d4b52f204e1aa3c069694f76ae89143c716f7213999748c3c2ce819ba1d"));
//#endregion
export { runRouterApi as a, queueRouterCommand as i, getRouterApi as n, saveRouterApi as o, previewRouterCommand as r, approveRouterCommand as t };
