function showResult(str) {
  document.querySelector("#result__container").classList.remove("hidden");
  document.querySelector("#result").value = str;
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.msg == "receivedAuth") {
    showResult(JSON.stringify(request.data));

    document.querySelector("#btn-intercept").innerText = "Xong rồi!";
  }

  if (request.msg == "receivedFriend") {
    let friends = request.data.map((row) => `${row.displayName}	${row.userId}`);
    friends = friends.join("\n");

    showResult(friends);
  }

  if (request.msg == "receivedGroup") {
    let groups = request.data.map((row) => `${row.displayName}	${row.userId}`);
    groups = groups.join("\n");

    showResult(groups);
  }
});

document
  .querySelector("#btn-intercept")
  .addEventListener("click", async (event) => {
    event.target.innerText = "Chờ, đừng tắt popup này...";
    chrome.runtime.sendMessage({ msg: "startIntercept" });
  });

document
  .querySelector("#btn-get-friend")
  .addEventListener("click", async (event) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { msg: "getFriend" });
    });
  });

document
  .querySelector("#btn-get-group")
  .addEventListener("click", async (event) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { msg: "getGroup" });
    });
  });
