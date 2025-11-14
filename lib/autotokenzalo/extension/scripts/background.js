var authData;
var imei;

async function interceptCallback(details) {
  console.log(details.url);

  if (/imei/.test(details.url)) (imei = /imei=([^&]+)/.exec(details.url)[1]);
  if (!/getLoginInfo/.test(details.url)) return;
  if (authData) return;

  // re-fetch API to be able to handle response body
  try {
    let res = await fetch(details.url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="114"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
      },
      referrer: "https://chat.zalo.me/",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: null,
      method: "GET",
      mode: "cors",
      credentials: "include",
    });

    let json = await res.json();

    authData = {
      client_version: /client_version=([^&]+)/.exec(details.url)[1],
      type: /type=([^&]+)/.exec(details.url)[1],
      zcid: /zcid=([^&]+)/.exec(details.url)[1],
      zcid_ext: /zcid_ext=([^&]+)/.exec(details.url)[1],
      imei: imei,
      cookies: await getCookies("zalo.me"),
      data: json.data,
    };

    chrome.runtime.sendMessage({ msg: "receivedAuth", data: authData });
  } catch (error) {
  } finally {
    stopIntercept();
    return { cancel: true };
  }
}

function getCookies(domain) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: domain }, (cookies) =>
      resolve(
        cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
      )
    );
  });
}

function stopIntercept() {
  chrome.webRequest.onBeforeRequest.removeListener(interceptCallback);
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.msg == "startIntercept") {
    // start API interceptor
    let filter = { urls: ["<all_urls>"] };
    let opt_extraInfoSpec = [];

    interceptor = chrome.webRequest.onBeforeRequest.addListener(
      interceptCallback,
      filter,
      opt_extraInfoSpec
    );

    // go to Zalo page
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.update(tabs[0].id, { url: "https://chat.zalo.me/" });
    });
  }

  if (request.msg == "stopIntercept") stopIntercept();
});
