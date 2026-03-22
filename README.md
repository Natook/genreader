# GEDCOM Viewer - Multi-User Web Application

A web-based GEDCOM family tree viewer with user authentication, allowing multiple users to manage their own genealogy files.

## Features

- 🔐 User authentication (email/password)
- 📁 File management (upload, view, delete GEDCOM files)
- 🌳 Interactive family tree viewer
- 🔍 Search functionality
- 🎉 "On This Day" feature showing birthdays and anniversaries
- 📝 Personal notes on family members
- 👥 Family relationships display
- 🇸🇪 Swedish language support

## Technology Stack

- **Backend**: Node.js with Express
- **Database**: SQLite (file-based, no server needed)
- **Authentication**: bcrypt + express-session
- **File Upload**: Multer
- **Frontend**: Vanilla JavaScript
- **Hosting**: Fly.io

## Local Development

### Prerequisites

- Node.js 18 or higher
- No database server needed! (Uses SQLite)

### Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
# Create a .env file or set these environment variables
SESSION_SECRET=your-secret-key-here
NODE_ENV=development
PORT=3000
```

3. Initialize the database:
```bash
npm run init-db
```

4. Start the development server:
```bash
npm run dev
```

5. Open http://localhost:3000 in your browser

## Deployment to Fly.io

### Prerequisites

- Fly.io CLI installed and authenticated
- Fly.io account

### Steps

1. **Create a Fly.io app**:
```bash
fly launch
```

When prompted:
- Say **NO** to PostgreSQL (we use SQLite now - it's free!)
- Accept other defaults or customize as needed

2. **Set the session secret**:
```bash
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
```

3. **Deploy the application**:
```bash
fly deploy
```

The database will be automatically initialized on first run and stored in persistent volumes (configured in fly.toml).

4. **Open your app**:
```bash
fly open
```

### Managing Your App

- **View logs**: `fly logs`
- **Check status**: `fly status`
- **Scale machines**: `fly scale count 2`
- **SSH into machine**: `fly ssh console`
- **View secrets**: `fly secrets list`
- **Set a secret**: `fly secrets set KEY=value`

### Database Management

- **Connect to database**: `fly postgres connect -a <postgres-app-name>`
- **View database logs**: `fly logs -a <postgres-app-name>`

## File Structure

```
├── server.js              # Express server with API endpoints
├── schema.sql             # Database schema
├── init-db.js            # Database initialization script
├── package.json          # Dependencies and scripts
├── Dockerfile            # Docker configuration
├── fly.toml              # Fly.io configuration
├── public/               # Static files served to users
│   ├── index.html        # Login page
│   ├── register.html     # Registration page
│   └── viewer.html       # Main GEDCOM viewer
└── uploads/              # User-uploaded GEDCOM files (created at runtime)
```

## API Endpoints

### Authentication
- `POST /api/register` - Create new user account
- `POST /api/login` - Login user
- `POST /api/logout` - Logout user
- `GET /api/user` - Get current user info

### File Management
- `POST /api/upload` - Upload GEDCOM file
- `GET /api/files` - List user's files
- `GET /api/files/:filename` - Download specific file
- `DELETE /api/files/:id` - Delete file

### Health
- `GET /health` - Health check endpoint

## Security Considerations

- Passwords are hashed using bcrypt
- Session cookies are HTTP-only
- Files are stored per-user and access is restricted
- HTTPS is enforced in production
- SQL injection protection via parameterized queries
- Database is file-based SQLite - no network exposure

## Environment Variables

- `SESSION_SECRET` - Secret key for session encryption
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 3000)

## Data Storage

- **Database**: Stored in `data/gedcom.db` (SQLite)
- **Sessions**: Stored in `data/sessions.db` (SQLite)
- **Uploads**: Stored in `uploads/` directory
- **On Fly.io**: All data persists in mounted volumes (configured in fly.toml)

## Support

For issues or questions, please check the Fly.io documentation at https://fly.io/docs/

## License

MIT
