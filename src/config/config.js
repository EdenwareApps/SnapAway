const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDirname } = require('cross-dirname');
const defaults = require('./defaults.json');

const name = 'SnapAway';
const dirname = __dirname;
const homedir = os.homedir();
const tmpdir = os.tmpdir();
const {env} = process;

const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
const localAppData = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');

class Config {
    constructor() {
        this.paths = {
            data: path.join(localAppData, name, 'Data'),
            config: path.join(appData, name, 'Config'),
            cache: path.join(localAppData, name, 'Cache'),
            log: path.join(localAppData, name, 'Log'),
            temp: path.join(tmpdir, name),
        };
        this.mainPath = path.join(this.paths.data, 'config.json');
        this.backupPath = this.mainPath +'.bak';
        this.data = this.loadData();
        this.proxy = this.getProxy();
    }

    getProxy() {
        const self = this;
        return new Proxy(this.data, {
            get(target, prop) {
                if (prop === 'toString') {
                    return () => JSON.stringify(target);
                }
                if (prop === 'toObject') {
                    return () => Object.assign({}, self.data);
                }
                if (prop === 'instance') {
                    return self;
                }
                if (prop === 'paths') {
                    return self.paths;
                }
                return target[prop];
            },
            set(target, prop, value) {
                target[prop] = value;
                self.saveData(target);
                return true;
            }
        });
    }

    loadData() {
        const ret = Object.assign({}, defaults);
        const orderedPaths = [this.mainPath, this.backupPath];
        for (const path of orderedPaths) {
            try {
                if (fs.existsSync(path)) {
                    const data = fs.readFileSync(path, 'utf8');
                    Object.assign(ret, JSON.parse(data));
                    break;
                }
            } catch (error) {
                console.error('Erro ao carregar o config:', error);
            }
        }
        
        // Migrate old file:// icon URLs to icon:// protocol for CSP compatibility
        if (ret.filters && Array.isArray(ret.filters)) {
            ret.filters.forEach(filter => {
                if (filter.icon && typeof filter.icon === 'string' && !filter.icon.startsWith('icon://')) {
                    if (filter.icon.startsWith('file://') || filter.icon.match(/^[a-zA-Z]:\\/)) {
                        // Convert file paths to icon:// protocol
                        const cleanPath = filter.icon.replace(/^file:\/\/\//, '');
                        filter.icon = 'icon://' + encodeURIComponent(cleanPath);
                        console.log('[CONFIG] Migrated filter icon to icon:// protocol for:', cleanPath);
                    }
                }
            });
        }
        
        return ret;
    }

    saveData(data) {
        try {
            fs.mkdirSync(path.dirname(this.mainPath), { recursive: true });            
        } catch (error) {}
        try {
            fs.writeFileSync(this.mainPath, JSON.stringify(data, null, 2));
            fs.writeFileSync(this.backupPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar o config:', error);
        }
    }

    toString() {
        return JSON.stringify(this.data);
    }
}

if (!global.configInstance) {
    global.configInstance = new Config(
        path.join(dirname, 'config.json'),
        path.join(dirname, 'defaults.json')
    );
}

module.exports = global.configInstance.proxy;
