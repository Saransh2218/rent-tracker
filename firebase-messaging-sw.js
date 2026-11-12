// Service worker that shows reminder notifications when the page is closed.
// The web config below is public and the same as in firebase-config.js.
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD6pfhxIq1uOa9pj4v2MIJBHuflkzZ-o_M",
  authDomain: "rent-tracker-47b98.firebaseapp.com",
  projectId: "rent-tracker-47b98",
  storageBucket: "rent-tracker-47b98.firebasestorage.app",
  messagingSenderId: "861476408234",
  appId: "1:861476408234:web:1f368d15e4e392ccf6b9d3"
});

// Creating the messaging object lets the library show notifications that
// the sender marks with a title and body, and open the link when tapped.
firebase.messaging();
