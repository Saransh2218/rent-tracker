// Public web configuration for the Firebase project.
// These values identify the project and are safe to keep in the page.
// Access is protected by login and the rules in firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyD6pfhxIq1uOa9pj4v2MIJBHuflkzZ-o_M",
  authDomain: "rent-tracker-47b98.firebaseapp.com",
  projectId: "rent-tracker-47b98",
  storageBucket: "rent-tracker-47b98.firebasestorage.app",
  messagingSenderId: "861476408234",
  appId: "1:861476408234:web:1f368d15e4e392ccf6b9d3"
};

// Where tenants send the rent. The UPI ID is shown on the tenant page
// and inside the QR code. "name" is the payee name shown in UPI apps.
export const UPI = {
  id: "bhagwatiprasadvaishnav2424@okaxis",
  name: "Room Rent"
};

// Public key that lets this site send browser notifications.
// It is safe to keep in the page.
export const VAPID_KEY = "BAcNh7lBYUcQKaGDGn8O0aqwM8MaJF9KRCxTiBvi-vFHcEJkXRYBOCMvaTcJ2bVcpgHTqTOqRY-CrC6WtM4-CgE";
