require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')

const app = express()
const port = Number(process.env.PORT) || 5000

if (!process.env.DATABASE_URL && !process.env.PGPASSWORD) {
	throw new Error('Set DATABASE_URL or PostgreSQL connection variables in backend/.env before starting the server')
}

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	host: process.env.PGHOST,
	port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
	database: process.env.PGDATABASE,
	user: process.env.PGUSER,
	password: process.env.PGPASSWORD,
	ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

app.use(cors())
app.use(express.json())

const initializeDatabase = async () => {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS employees (
			id SERIAL PRIMARY KEY,
			name VARCHAR(120) NOT NULL,
			title VARCHAR(160) NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
}

const employeeFields = (body) => {
	const name = typeof body.name === 'string' ? body.name.trim() : ''
	const title = typeof body.title === 'string' ? body.title.trim() : ''

	if (!name || !title) {
		return { error: 'name and title are required' }
	}

	if (name.length > 120 || title.length > 160) {
		return { error: 'name must be 120 characters or fewer and title 160 characters or fewer' }
	}

	return { name, title }
}

app.get('/health', async (req, res) => {
	try {
		await pool.query('SELECT 1')
		res.json({ status: 'ok' })
	} catch (error) {
		res.status(503).json({ status: 'error', message: 'Database unavailable' })
	}
})

app.get('/api/employees', async (req, res, next) => {
	try {
		const result = await pool.query(
			'SELECT id, name, title, created_at, updated_at FROM employees ORDER BY id DESC',
		)
		res.json(result.rows)
	} catch (error) {
		next(error)
	}
})

app.post('/api/employees', async (req, res, next) => {
	const fields = employeeFields(req.body)
	if (fields.error) {
		return res.status(400).json({ error: fields.error })
	}

	try {
		const result = await pool.query(
			'INSERT INTO employees (name, title) VALUES ($1, $2) RETURNING id, name, title, created_at, updated_at',
			[fields.name, fields.title],
		)
		res.status(201).json(result.rows[0])
	} catch (error) {
		next(error)
	}
})

app.put('/api/employees/:id', async (req, res, next) => {
	const employeeId = Number.parseInt(req.params.id, 10)
	const fields = employeeFields(req.body)

	if (!Number.isInteger(employeeId) || employeeId < 1) {
		return res.status(400).json({ error: 'id must be a positive integer' })
	}
	if (fields.error) {
		return res.status(400).json({ error: fields.error })
	}

	try {
		const result = await pool.query(
			'UPDATE employees SET name = $1, title = $2, updated_at = NOW() WHERE id = $3 RETURNING id, name, title, created_at, updated_at',
			[fields.name, fields.title, employeeId],
		)

		if (result.rowCount === 0) {
			return res.status(404).json({ error: 'Employee not found' })
		}

		res.json(result.rows[0])
	} catch (error) {
		next(error)
	}
})

app.delete('/api/employees/:id', async (req, res, next) => {
	const employeeId = Number.parseInt(req.params.id, 10)

	if (!Number.isInteger(employeeId) || employeeId < 1) {
		return res.status(400).json({ error: 'id must be a positive integer' })
	}

	try {
		const result = await pool.query('DELETE FROM employees WHERE id = $1', [employeeId])

		if (result.rowCount === 0) {
			return res.status(404).json({ error: 'Employee not found' })
		}

		res.status(204).send()
	} catch (error) {
		next(error)
	}
})

app.use((error, req, res, next) => {
	console.error(error)
	res.status(500).json({ error: 'Internal server error' })
})

const start = async () => {
	try {
		await initializeDatabase()
		const server = app.listen(port, () => {
			console.log(`Employee API listening on http://localhost:${port}`)
		})

		const shutdown = async () => {
			server.close(async () => {
				await pool.end()
				process.exit(0)
			})
		}

		process.on('SIGINT', shutdown)
		process.on('SIGTERM', shutdown)
	} catch (error) {
		console.error('Unable to start server:', error.message)
		await pool.end()
		process.exit(1)
	}
}

start()
