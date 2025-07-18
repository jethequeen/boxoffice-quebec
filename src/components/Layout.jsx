import { Link, useLocation } from 'react-router-dom'
import './Layout.css'

function Layout({ children }) {
  const location = useLocation()

  const navItems = [
    { path: '/', label: 'Tableau de bord' },
    { path: '/movies', label: 'Films'},
    { path: '/directors', label: 'Réalisateurs' },
  ]

  return (
    <div className="layout">
      <header className="header">
        <div className="header-content">
          <h1 className="site-title">
            <span className="title-icon"></span>
            Box-Office Québec
          </h1>
          <nav className="nav">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      
      <main className="main-content">
        {children}
      </main>
      
      <footer className="footer">
        <div className="footer-content">
          <p>&copy; 2025 Box-Office Québec - Données et analyses du cinéma québécois</p>
        </div>
      </footer>
    </div>
  )
}

export default Layout
