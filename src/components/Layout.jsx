import { Link, useLocation } from 'react-router-dom';
import SearchBar from './searchbar.jsx';
import './Layout.css';

function Layout({ children }) {
    const location = useLocation();
    const navItems = [
        { path: '/', label: 'Accueil' },
        { path: '/box-office', label: 'Box Office' },
        { path: '/movies', label: 'Films' },
    ];

    return (
        <div className="layout">
            <header className="header">
                <div className="header-content">
                    <h1 className="site-title">
                        <span className="title-icon"></span>
                        Box-Office Québec
                    </h1>

                    <div className="header-search">
                        <SearchBar />
                    </div>

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

            <main className="main-content">{children}</main>

            <footer className="footer">
                <div className="footer-content">
                    <p>&copy; 2025 The Black Box - Données et analyses du cinéma québécois</p>
                </div>
            </footer>
        </div>
    );
}
export default Layout;
