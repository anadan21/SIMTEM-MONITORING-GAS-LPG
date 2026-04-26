/**
 * js/firebase-init.js
 * Inisialisasi Firebase — diimport oleh dashboard.js dan chart.js
 */
import { firebaseConfig } from '../firebase-config.js';
import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);