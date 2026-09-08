import { r as createServerFn } from "./ssr.mjs";
import { t as authMiddleware } from "./middleware-DSMJxnKB.mjs";
import { n as createSsrRpc } from "./router-DH5OVAuE.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-D7YxL8yv.js
var getDashboard = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("cb0a572eb9356911f9f3e76366206dc0242d0bce25cc9dd2ed0a14acbe0a95dd"));
var listCustomers = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("d9d3c88c37b6987ccdc28add8b12626a91aa49ac24954d749898588ad38cfc0b"));
var createCustomer = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("7333f74816133aef0c5a756e38329e0b8ebbd9bf77e991cdefd304a698570ff3"));
var listPackages = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("e78843982652677c66d853dedd123a6a16bf73e7398cde1a3c81a6f0678c1e37"));
var createPackage = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("62f12a16c4a9fbb6f3114600ea27fcf4af4d5fa62aea2d9bab5e729f32e46b02"));
var listServices = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("6dc3a12f614ad2143321f5f24d068bfc75df5f073d111dea1f2d907e95cc4c4f"));
var createService = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("fb8f4084dd5b89df9ed7de4fee9d7846f044eceed9cafadec3e9fc9138dc4d5e"));
var setServiceStatus = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("107df89607f4cf5642dd84e0b797075cd2a0d6ae8daf02cb91ea183e8afc75a8"));
var listBilling = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("3038cd6cc8f6f407e8479001e53c68728b0cc653d5648490041e1270e05909e0"));
var createInvoice = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("6a88e38a76ab45f9b3bd545076de5dca7a1c8e894e5cf2c824a687763893288a"));
var recordPayment = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("21aa30200fbb871771a87c4ace21132b156363e6170f90c2c46f9c3c37e47d6a"));
var listRouters = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("5139ec72ef7cd95594c293eae3021b86b86a3c91020bab91f8cdcf531ddefbb1"));
var addRouter = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("1da6e3801cdc10c2df0cca6dc0e85b43356baa8aeef50bba4d00741b618b05c8"));
var listTickets = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("fbbe28f960b118c4ac3fcbc69927b1048dd832e6275e0258b170198c07a264bf"));
var createTicket = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("830e682f10512ee2eee1cd75d71f0db022bb8c479fea20858c2e35a1f11eb0d9"));
var setTicketStatus = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("f9f4f5cc635047ddc6b6f5a986c941472688c45a108340df6f8c5cba87355c52"));
var renameTenant = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("927c7845d2692853774f93db8a0bf205fde11794f72073a81ed2f971cc41d4dd"));
var importCustomers = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("4cdcbc4d92e44f708c9ad19679788d00e050ec32d37b244e75e96e6be971c79b"));
var exportCustomersCsv = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("9f22ac761f3885e9157652a1b6472e6e6ae76548e42fc0a8ea03e999587dd762"));
//#endregion
export { renameTenant as _, createService as a, getDashboard as c, listCustomers as d, listPackages as f, recordPayment as g, listTickets as h, createPackage as i, importCustomers as l, listServices as m, createCustomer as n, createTicket as o, listRouters as p, createInvoice as r, exportCustomersCsv as s, addRouter as t, listBilling as u, setServiceStatus as v, setTicketStatus as y };
