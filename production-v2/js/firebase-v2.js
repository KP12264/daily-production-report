// Production V2 Firebase safety layer. V2 writes are restricted to prodV2_* only.
const firebaseConfigV2={apiKey:"AIzaSyCJQtvQE6DCk64hPZz4WATTC2c01GiJ53c",authDomain:"daily-production-report-46b60.firebaseapp.com",projectId:"daily-production-report-46b60",storageBucket:"daily-production-report-46b60.firebasestorage.app",messagingSenderId:"275988223035",appId:"1:275988223035:web:11e2c55c8c38c2f9e5f81e"};
let dbV2=null;
try{if(typeof firebase!=="undefined"){if(!firebase.apps.length)firebase.initializeApp(firebaseConfigV2);dbV2=firebase.firestore();}}catch(e){console.error("Production V2 Firebase init failed",e)}
const V2_PREFIX="prodV2_";
function assertV2Collection(name){if(typeof name!=="string"||!name.startsWith(V2_PREFIX))throw new Error("SAFETY BLOCK: Production V2 may write only to prodV2_* collections. Blocked: "+name);return name;}
function v2Collection(name){if(!dbV2)throw new Error("Firestore is not available");return dbV2.collection(assertV2Collection(name));}
function normalizeSetOptions(options){
 // Firestore requires a SetOptions object like {merge:true}. Some call sites in this
 // codebase historically passed the boolean literal `true` instead, which Firestore
 // does NOT treat as merge:true — it silently falls back to a full overwrite of the
 // document. Normalize any truthy-but-not-object value to {merge:true} so every
 // v2Set() call merges as intended, and preserve real SetOptions objects untouched.
 if(options&&typeof options==="object")return options;
 if(options)return{merge:true};
 return{};
}
function v2SanitizeUndefined(value){
 // Firestore rejects any field whose value is literally `undefined` (it
 // accepts `null` fine). Call sites across V2 build plain objects with
 // fallbacks like `x||null`, but any path that misses one — a field read
 // off a Firestore doc that simply doesn't have that key, an array index
 // that was never set — throws "Unsupported field value: undefined" deep
 // inside the SDK with no indication of which field caused it. Recursing
 // here once, at the single choke point all V2 writes pass through, means
 // no call site has to get every fallback right by hand.
 if(value===undefined)return null;
 if(value===null||typeof value!=="object")return value;
 if(Array.isArray(value))return value.map(v2SanitizeUndefined);
 // Firestore sentinels (FieldValue.serverTimestamp(), Timestamp, GeoPoint,
 // DocumentReference, etc.) are class instances, not plain objects — leave
 // them untouched or Firestore will fail to recognize them.
 if(value.constructor!==Object)return value;
 let out={};
 for(let k of Object.keys(value))out[k]=v2SanitizeUndefined(value[k]);
 return out;
}
async function v2Set(collection,id,data,options){return v2Collection(collection).doc(id).set(v2SanitizeUndefined(data),normalizeSetOptions(options));}
async function v2Add(collection,data){return v2Collection(collection).add(v2SanitizeUndefined(data));}
async function v2Update(collection,id,data){return v2Collection(collection).doc(id).update(v2SanitizeUndefined(data));}
async function v2Delete(collection,id){return v2Collection(collection).doc(id).delete();}
window.ProdV2DB={db:()=>dbV2,collection:v2Collection,set:v2Set,add:v2Add,update:v2Update,delete:v2Delete,prefix:V2_PREFIX};
