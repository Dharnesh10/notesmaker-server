const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const cors = require('cors');
const app = express();
const PORT = 5000;
require('dotenv').config();
const multer = require('multer');
const path = require('path');

app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve static images

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// === MIDDLEWARE ===
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, 
    secure: false, // true if using HTTPS in prod
    maxAge: 3600000 // 1 hour
  }
}));

// === MYSQL CONNECTION ===
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'dharnesh10',
  database: 'notesmaker',
});
db.connect(err => {
  if (err) throw err;
  console.log('✅ MySQL connected');
});

// === AUTH ROUTES ===

// REGISTER
app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.sendStatus(500);
    db.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hash],
      (err, result) => {
        if (err) return res.status(500).json({ error: 'Signup failed' });
        res.json({ message: 'User registered' });
      }
    );
  });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  db.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
    if (err || result.length === 0) return res.status(401).json({ message: 'Invalid credentials' });

    bcrypt.compare(password, result[0].password, (err, same) => {
      if (!same) return res.status(401).json({ message: 'Invalid credentials' });

      req.session.user = { id: result[0].id, name: result[0].name };
      res.json({ message: 'Login successful', user: req.session.user });
    });
  });
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.clearCookie('connect.sid');
  res.json({ message: 'Logged out' });
});

// GET LOGGED-IN USER
app.get('/api/me', (req, res) => {
  if (req.session.user) {
    res.json({ id: req.session.user.id, name: req.session.user.name });
  } else {
    res.status(401).json({ message: 'Not logged in' });
  }
});

// === SUBJECT ROUTES ===

// Get all subjects for logged-in user
app.get('/api/subjects', (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  db.query('SELECT * FROM subjects WHERE user_id = ?', [userId], (err, result) => {
    if (err) return res.sendStatus(500);
    res.json(result);
  });
});

// Create a new subject
app.post('/api/subjects', (req, res) => {
  const userId = req.session.user?.id;
  const { title } = req.body;
  if (!userId) return res.sendStatus(401);
  if (!title) return res.status(400).json({ error: 'Title is required' });

  db.query('INSERT INTO subjects (user_id, title) VALUES (?, ?)', [userId, title], (err, result) => {
    if (err) return res.sendStatus(500);
    res.json({ id: result.insertId, title });
  });
});

// Delete subject by ID
app.delete('/api/subjects/:id', (req, res) => {
  const userId = req.session.user?.id;
  const subjectId = req.params.id;

  if (!userId) return res.sendStatus(401);

  db.query(
    'DELETE FROM subjects WHERE id = ? AND user_id = ?',
    [subjectId, userId],
    (err, result) => {
      if (err) return res.sendStatus(500);
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Subject not found or not owned by you' });
      res.json({ message: 'Subject deleted' });
    }
  );
});

// === TOPICS ROUTES ===

// Get topics for a subject
app.get('/api/subjects/:subjectId/topics', (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  const { subjectId } = req.params;
  db.query(
    'SELECT * FROM topics WHERE subject_id = ?',
    [subjectId],
    (err, result) => {
      if (err) return res.sendStatus(500);
      res.json(result);
    }
  );
});

// Add topic to a subject
app.post('/api/subjects/:subjectId/topics', (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  const { subjectId } = req.params;
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  db.query(
    'INSERT INTO topics (subject_id, title) VALUES (?, ?)',
    [subjectId, title],
    (err, result) => {
      if (err) return res.sendStatus(500);
      res.json({ id: result.insertId, title });
    }
  );
});

// ✅ Update a topic (FIXED route path!)
app.put('/api/topics/:topicId', (req, res) => {
  const { topicId } = req.params;
  const { title } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  db.query(
    'UPDATE topics SET title = ? WHERE id = ?',
    [title, topicId],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to update topic' });
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Topic not found' });
      }
      res.json({ message: 'Topic updated' });
    }
  );
});

// ✅ Delete a topic (FIXED route path!)
app.delete('/api/topics/:topicId', (req, res) => {
  const { topicId } = req.params;

  db.query(
    'DELETE FROM topics WHERE id = ?',
    [topicId],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to delete topic' });
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Topic not found' });
      }
      res.json({ message: 'Topic deleted' });
    }
  );
});


// === NOTES ROUTES ===

// Get notes for a topic
app.get('/api/topics/:topicId/notes', (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  const { topicId } = req.params;
  db.query(
    'SELECT * FROM notes WHERE topic_id = ?',
    [topicId],
    (err, result) => {
      if (err) return res.sendStatus(500);
      res.json(result);
    }
  );
});

// Add note to a topic
// app.post('/api/topics/:topicId/notes', (req, res) => {
//   const userId = req.session.user?.id;
//   if (!userId) return res.sendStatus(401);

//   const { topicId } = req.params;
//   const { content } = req.body;
//   if (!content) return res.status(400).json({ error: 'Content is required' });

//   db.query(
//     'INSERT INTO notes (topic_id, content) VALUES (?, ?)',
//     [topicId, content],
//     (err, result) => {
//       if (err) return res.sendStatus(500);
//       res.json({ id: result.insertId, content });
//     }
//   );
// });

app.post('/api/topics/:topicId/notes', upload.single('image'), (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  const { topicId } = req.params;
  const { content } = req.body;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!content) return res.status(400).json({ error: 'Content is required' });

  db.query(
    'INSERT INTO notes (topic_id, content, image_path) VALUES (?, ?, ?)',
    [topicId, content, imagePath],
    (err, result) => {
      if (err) return res.sendStatus(500);
      res.json({ id: result.insertId, content, image_path: imagePath });
    }
  );
});



// update a note
app.put('/api/topics/:topicId/notes/:noteId', (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  const { topicId, noteId } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });

  db.query(
    'UPDATE notes SET content = ? WHERE id = ? AND topic_id = ?',
    [content, noteId, topicId],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to update note' });
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Note not found' });
      }
      res.json({ message: 'Note updated' });
    }
  );
});

// delete a note
app.delete('/api/topics/:topicId/notes/:noteId', (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.sendStatus(401);

  const { topicId, noteId } = req.params;

  db.query(
    'DELETE FROM notes WHERE id = ? AND topic_id = ?',
    [noteId, topicId],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to delete note' });
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Note not found' });
      }
      res.json({ message: 'Note deleted' });
    }
  );
});

//Online topics get from all users 

app.get('/api/subjects/topics/online', (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.sendStatus(401);

  db.query('SELECT * FROM topics', (err, results) => {
    if (err) {
      console.error(err);
      return res.sendStatus(500);
    }
    res.json(results);
  });
});



// === TEST AUTH ===
app.get('/api/checkAuth', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ message: 'Not logged in' });
  }
});

// === START SERVER ===
app.listen(PORT, () => console.log(`🚀 Server running on ➜ http://localhost:${PORT}`));
