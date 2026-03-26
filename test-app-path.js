const process = require('process');
function getAppPath(execPath) {
    const contentsIdx = execPath.indexOf('/Contents/');
    if (contentsIdx !== -1) {
        return execPath.substring(0, contentsIdx);
    }
    return '';
}
console.log(getAppPath('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)'));
