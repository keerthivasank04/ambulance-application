import { Link, useLocation, useParams } from 'react-router-dom';

const LABELS = {
  request: 'Request Ambulance',
  track:   'Live Tracking',
  driver:  'Driver Portal',
  admin:   'Control Room',
  login:   'Sign In',
};

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const params = useParams();

  if (pathname === '/') return null;

  const segments = pathname.split('/').filter(Boolean);
  const crumbs = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');
    const isId = Object.values(params).includes(seg);
    const label = isId ? `#${seg.slice(-6)}` : (LABELS[seg] || seg);
    return { path, label, isLast: i === segments.length - 1 };
  });

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <div className="container breadcrumbs-inner">
        <Link to="/">Home</Link>
        {crumbs.map(c => (
          <span key={c.path} className="breadcrumbs-item">
            <span className="breadcrumbs-sep">/</span>
            {c.isLast ? <span aria-current="page">{c.label}</span> : <Link to={c.path}>{c.label}</Link>}
          </span>
        ))}
      </div>
    </nav>
  );
}
