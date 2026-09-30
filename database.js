import pg from 'pg';
const { Pool }=pg;
export async function createArchive(url,orgId){
 const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 pool.on('error',()=>console.error('Database pool connection error'));
 await pool.query(`CREATE TABLE IF NOT EXISTS oucu_calls (
 org_id text NOT NULL, call_id text NOT NULL, call_date date NOT NULL,
 created_time bigint NOT NULL, observed_at timestamptz NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(org_id,call_id));
 CREATE INDEX IF NOT EXISTS oucu_calls_date ON oucu_calls(org_id,call_date);
 CREATE TABLE IF NOT EXISTS oucu_agent_observations (
 org_id text NOT NULL, observed_at timestamptz NOT NULL, agent_id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(org_id,observed_at,agent_id));
 CREATE TABLE IF NOT EXISTS oucu_sync_state (org_id text PRIMARY KEY, updated_at timestamptz NOT NULL, payload jsonb NOT NULL);
 CREATE TABLE IF NOT EXISTS oucu_secure_storage (org_id text NOT NULL, storage_key text NOT NULL, ciphertext text NOT NULL, PRIMARY KEY(org_id,storage_key));`);
 return {
 async saveCalls(data){
  const client=await pool.connect();try{await client.query('BEGIN');
   for(const t of data.calls){if(!t.id||!Number.isFinite(t.createdTime))throw Error('Invalid archived call');
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(t.createdTime));
    await client.query(`INSERT INTO oucu_calls VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(org_id,call_id) DO UPDATE SET call_date=EXCLUDED.call_date,created_time=EXCLUDED.created_time,observed_at=EXCLUDED.observed_at,payload=EXCLUDED.payload
    WHERE oucu_calls.observed_at<=EXCLUDED.observed_at`,[orgId,t.id,date,t.createdTime,data.updatedAt,JSON.stringify(t)]);
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 },
 async readCalls(date){const r=await pool.query('SELECT payload FROM oucu_calls WHERE org_id=$1 AND call_date=$2 ORDER BY created_time DESC',[orgId,date]);return r.rows.map(r=>r.payload)},
 async saveAgents(data){for(const a of data.agents)await pool.query('INSERT INTO oucu_agent_observations VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[orgId,data.updatedAt,a.id,JSON.stringify(a)])},
 async saveSync(value){await pool.query('INSERT INTO oucu_sync_state VALUES($1,now(),$2) ON CONFLICT(org_id) DO UPDATE SET updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload',[orgId,JSON.stringify(value)])},
 async status(){const r=await pool.query('SELECT payload,updated_at FROM oucu_sync_state WHERE org_id=$1',[orgId]);const count=await pool.query('SELECT count(*)::int AS calls FROM oucu_calls WHERE org_id=$1',[orgId]);return {connected:true,storedCalls:count.rows[0].calls,sync:r.rows[0]?.payload||null}},
 async get(k){const r=await pool.query('SELECT ciphertext FROM oucu_secure_storage WHERE org_id=$1 AND storage_key=$2',[orgId,k]);return r.rows[0]?.ciphertext||null},
 async put(k,v){await pool.query('INSERT INTO oucu_secure_storage VALUES($1,$2,$3) ON CONFLICT(org_id,storage_key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext',[orgId,k,v])},
 async delete(k){await pool.query('DELETE FROM oucu_secure_storage WHERE org_id=$1 AND storage_key=$2',[orgId,k])},
 async close(){await pool.end()}
 };
}
