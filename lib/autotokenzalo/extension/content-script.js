function getAllIndexedDBData(databaseName, objectStoreName) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName);

    request.onerror = function (event) {
      reject(new Error("Error opening database: " + event.target.errorCode));
    };

    request.onsuccess = function (event) {
      const db = event.target.result;
      const transaction = db.transaction(objectStoreName, "readonly");
      const objectStore = transaction.objectStore(objectStoreName);
      const getAllRequest = objectStore.getAll();

      getAllRequest.onsuccess = function (event) {
        resolve(event.target.result);
      };

      getAllRequest.onerror = function (event) {
        reject(new Error("Error retrieving data: " + event.target.errorCode));
      };
    };
  });
}

async function getFriend() {
  let r = await indexedDB.databases();
  let db = r.find((db) => /zdb_[0-9]+/.test(db.name));
  let friends = await getAllIndexedDBData(db.name, "friend");
  return friends;
}

async function getGroup() {
  let r = await indexedDB.databases();
  let db = r.find((db) => /zdb_[0-9]+/.test(db.name));
  let friends = await getAllIndexedDBData(db.name, "group");
  return friends;
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.msg == "getFriend") {
    getFriend().then(data => chrome.runtime.sendMessage({ msg: "receivedFriend", data: data }));
  }

  if (request.msg == "getGroup") {
    getGroup().then(data => chrome.runtime.sendMessage({ msg: "receivedGroup", data: data }));
  }
});
