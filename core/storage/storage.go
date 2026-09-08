package storage

import (
	"database/sql"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
)

func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, q := range []string{"PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000", schema} {
		if _, err = db.Exec(q); err != nil {
			db.Close()
			return nil, err
		}
	}
	tx, err := db.Begin()
	if err != nil {
		db.Close()
		return nil, err
	}
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,key TEXT NOT NULL,value BLOB NOT NULL,PRIMARY KEY(kind,key)); INSERT OR IGNORE INTO migrations VALUES(2);`); err != nil {
		tx.Rollback()
		db.Close()
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO migrations VALUES(1);
CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, principal TEXT NOT NULL, hash TEXT NOT NULL,response BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, data BLOB NOT NULL, time TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS state_values(key TEXT PRIMARY KEY,value BLOB NOT NULL,revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,capabilities BLOB NOT NULL,last_seen TEXT);
CREATE TABLE IF NOT EXISTS grants(principal TEXT NOT NULL,capability TEXT NOT NULL,target TEXT NOT NULL,state TEXT NOT NULL,expires TEXT NOT NULL DEFAULT '',PRIMARY KEY(principal,capability,target));
CREATE TABLE IF NOT EXISTS invocations(id TEXT PRIMARY KEY,principal TEXT NOT NULL,node TEXT NOT NULL,capability TEXT NOT NULL,input BLOB NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,deadline TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,result BLOB);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY REFERENCES invocations(id),next_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desired(node TEXT NOT NULL,capability TEXT NOT NULL,input BLOB NOT NULL,principal TEXT NOT NULL,PRIMARY KEY(node,capability));
CREATE TABLE IF NOT EXISTS audit_entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,principal TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,decision TEXT NOT NULL,correlation TEXT NOT NULL,time TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
`
