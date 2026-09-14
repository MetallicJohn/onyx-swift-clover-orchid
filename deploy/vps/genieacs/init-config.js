// Idempotent GenieACS Mongo config. Digest auth + connection-request auth.
// Run from compose genieacs-init against mongodb://mongo/genieacs.

const auth = 'AUTH(USERNAME, EXT("gridline", "passwordFor", USERNAME))';
const connreq = "AUTH(username, password)";

db = db.getSiblingDB("genieacs");

db.config.updateOne({ _id: "cwmp.auth" }, { $set: { value: auth } }, { upsert: true });
db.config.updateOne({ _id: "cwmp.connectionRequestAuth" }, { $set: { value: connreq } }, { upsert: true });
db.config.updateOne(
  { _id: "cwmp.connectionRequestAllowBasicAuth" },
  { $set: { value: "true" } },
  { upsert: true },
);

print("gridline cwmp security config upserted");
