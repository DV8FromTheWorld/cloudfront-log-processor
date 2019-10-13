const path       = require('path')
const fs         = require('fs')
const fsPromises = fs.promises

async function safeAppend(destFile, contents, attempt = 0, backoff = 100) {
  try {
    await fsPromises.appendFile(destFile, contents)
  }
  catch (err) {
    if (err.code !== 'EBUSY' || attempt > 3) {
      throw err
    }

    await new Promise(resolve => setTimeout(resolve, backoff + Math.round(Math.random() * 100)))
    await safeAppend(destFile, content, attempt + 1, backoff + 100)
  }
}

//Credit: https://stackoverflow.com/a/40686853/3813641
async function ensureDirExists(targetDir, { isRelativeToScript = false } = {}) {
  const sep = path.sep;
  const initDir = path.isAbsolute(targetDir) ? sep : '';
  const baseDir = isRelativeToScript ? __dirname : '.';

  return targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = path.resolve(baseDir, parentDir, childDir);
    try {
      fs.mkdirSync(curDir);
    } catch (err) {
      if (err.code === 'EEXIST') { // curDir already exists!
        return curDir;
      }

      // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
      if (err.code === 'ENOENT') { // Throw the original parentDir error on curDir `ENOENT` failure.
        throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`);
      }

      const caughtErr = ['EACCES', 'EPERM', 'EISDIR'].indexOf(err.code) > -1;
      if (!caughtErr || caughtErr && curDir === path.resolve(targetDir)) {
        throw err; // Throw if it's just the last created dir.
      }
    }

    return curDir;
  }, initDir);
}

module.exports = {
  ensureDirExists,
  safeAppend
}