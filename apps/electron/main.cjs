const path = require('node:path')
const { app, BrowserWindow, Menu } = require('electron')

const ALLOWED_ROUTES = new Set(['/main', '/station', '/admin'])

function resolveRoute(inputRoute) {
  const normalized = String(inputRoute || '/main')
    .trim()
    .toLowerCase()
  return ALLOWED_ROUTES.has(normalized) ? normalized : '/main'
}

function buildDevUrl(baseUrl, routePath) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return `${base}#${routePath}`
}

function createWindow() {
  const routePath = resolveRoute(process.env.MOONWALK_DEFAULT_ROUTE)
  const mainWindow = new BrowserWindow({
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#05070c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setMenu(null)

  const rendererUrl = process.env.MOONWALK_RENDERER_URL

  if (rendererUrl) {
    mainWindow.loadURL(buildDevUrl(rendererUrl, routePath))
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'), {
      hash: routePath,
    })
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
