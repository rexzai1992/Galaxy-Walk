import DevNav from './components/DevNav.jsx'
import AppRoutes from './routes/AppRoutes.jsx'

function App() {
  return (
    <>
      {import.meta.env.DEV ? <DevNav /> : null}
      <AppRoutes />
    </>
  )
}

export default App
