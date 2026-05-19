import sqlite3
conn = sqlite3.connect(r"C:\Users\eab\tanker-risk\tanker-risk\backend\data\vlcc.db")
row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='vessels'").fetchone()
print(row[0])
conn.close()
