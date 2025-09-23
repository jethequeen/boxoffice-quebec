import { Link, useLocation } from 'react-router-dom';
import SearchBar from './searchbar.jsx';
import './Layout.css';
import logo from '../assets/cineStatsTextLessLogo.png'; // << PNG without text

function Layout({ children }) {
    const location = useLocation();
    const navItems = [
        { path: '/box-office', label: 'Box Office' },
        { path: '/movies', label: 'Films' },
    ];

    return (
        <div className="layout">
            <header className="header">
                <div className="header-content">
                    {/* Brand: logo + wordmark (same presence as old title) */}
                    <Link to="/" className="brand" aria-label="Ciné Stats – Accueil">
                        <img src={logo} alt="" className="brand-logo" />
                        <span className="brand-name">Ciné&nbsp;Stats</span>
                    </Link>

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
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </header>

            <main className="main-content">{children}</main>

            <footer className="footer">
                <div className="footer-content">
                    <p>&copy; 2025 Cine Stats - Données et analyses du cinéma québécois</p>
                </div>
            </footer>
        </div>
    );
}
export default Layout;
