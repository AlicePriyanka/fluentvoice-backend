# FluentVoice Backend

Express.js + TypeScript REST API backend for the FluentVoice speech therapy app.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js v4
- **Language**: TypeScript
- **Database**: SQLite (via `better-sqlite3`) — local file-based, no cloud needed
- **Auth**: JWT via `jose`, cookies via `cookie-parser`
- **Media**: Cloudinary (audio uploads)
- **Password**: `bcryptjs`

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create a `.env` file in the project root:

```env
JWT_SECRET=your_jwt_secret_here
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
PORT=5001
```

### 3. Set up the database

Creates the local SQLite database file (`fluentvoice.db`) and all tables:

```bash
npm run db:setup
```

### 4. Seed test data (optional)

Populates the database with test users, sessions, and appointments:

```bash
npm run db:seed
```

**Test credentials** (all use password `TestPass123`):

| Role | Email |
|---|---|
| Therapist | `testtherapist@fluentvoice.io` |
| Patient 1 | `testpatient@fluentvoice.io` |
| Patient 2 | `janedoe@fluentvoice.io` |

### 5. Run the development server

```bash
npm run dev
```

The backend server will start on **port 5001** (or the `PORT` value from `.env`).

### 6. Build for production

```bash
npm run build
npm start
```

## API Routes

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/me` | Get current user |
| `POST` | `/api/auth/forgot-password` | Reset password |
| `GET` | `/api/sessions` | Get user sessions |
| `POST` | `/api/sessions` | Save a session |
| `GET` | `/api/profile` | Get user profile |
| `PUT` | `/api/profile` | Update user profile |
| `GET` | `/api/appointments` | Get appointments |
| `POST` | `/api/appointments` | Book appointment |
| `PUT` | `/api/appointments/:id` | Update appointment status |
| `DELETE` | `/api/appointments/:id` | Delete appointment |
| `GET` | `/api/therapist/patients` | Therapist: list patients |
| `GET` | `/api/therapist/patients/:id` | Therapist: patient detail |
| `GET` | `/api/treatment` | Get treatment plan |
| `PUT` | `/api/treatment` | Save treatment plan |
| `POST` | `/api/analyze` | Analyze speech audio (proxied to HuggingFace) |
| `POST` | `/api/upload-audio` | Upload audio to Cloudinary |

## Database Schema

The SQLite database (`fluentvoice.db`) consists of the following tables:

- `users` — stores both patients and therapists
- `profiles` — extended profile info per user
- `sessions` — speech analysis session records
- `appointments` — patient-therapist appointment records
- `treatment_plans` — therapist-assigned treatment plans per patient
# fluentvoice-backend
