const fs = require('fs-extra');
const path = require('path');

// Eliminar la carpeta de autenticación que contiene la sesión guardada
const authFolder = path.join(__dirname, '.wwebjs_auth');
const cacheFolder = path.join(__dirname, '.wwebjs_cache');

// Eliminar ambas carpetas
fs.removeSync(authFolder);
fs.removeSync(cacheFolder);

console.log('✅ Autenticación reiniciada. La próxima vez que ejecutes el bot, se generará un nuevo código QR.');