import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const Layout: React.FC = () => {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <div style={{ display: 'flex', height: '100vh', fontFamily: `'Noto Sans KR', sans-serif` }}>
            {/* Sidebar */}
            <aside style={{ width: '250px', backgroundColor: '#f8f9fa', padding: '20px', borderRight: '1px solid #ddd' }}>
                <h2 style={{ marginBottom: '30px', color: '#333' }}>Jaegeun Storybook</h2>
                <nav>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        <li style={{ marginBottom: '10px' }}>
                            <Link to="/" style={{
                                textDecoration: 'none',
                                color: isActive('/') ? '#007bff' : '#333',
                                fontWeight: isActive('/') ? 'bold' : 'normal',
                                display: 'block',
                                padding: '10px',
                                borderRadius: '5px',
                                backgroundColor: isActive('/') ? '#e9ecef' : 'transparent'
                            }}>
                                Dashboard
                            </Link>
                        </li>
                        <li>
                            <Link to="/settings" style={{
                                textDecoration: 'none',
                                color: isActive('/settings') ? '#007bff' : '#333',
                                fontWeight: isActive('/settings') ? 'bold' : 'normal',
                                display: 'block',
                                padding: '10px',
                                borderRadius: '5px',
                                backgroundColor: isActive('/settings') ? '#e9ecef' : 'transparent'
                            }}>
                                Settings
                            </Link>
                        </li>
                    </ul>
                </nav>
            </aside>

            {/* Main Content */}
            <main style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
                <Outlet />
            </main>
        </div>
    );
};

export default Layout;
