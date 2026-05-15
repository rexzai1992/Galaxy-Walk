import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/main', label: '/main' },
  { to: '/station', label: '/station' },
  { to: '/admin', label: '/admin' },
]

function DevNav() {
  return (
    <nav className="dev-nav" aria-label="Development navigation">
      <span className="dev-nav-label">Dev Navigation</span>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => (isActive ? 'dev-nav-link active' : 'dev-nav-link')}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default DevNav
