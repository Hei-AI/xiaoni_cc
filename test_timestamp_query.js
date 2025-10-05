const mysql = require('mysql2/promise');

(async () => {
  const connection = await mysql.createConnection({
    host: 'qqbot-mysql',
    port: 3306,
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db',
    charset: 'utf8mb4',
    timezone: '+08:00'
  });

  const [rows] = await connection.execute(`
    SELECT
      id, request_id, trace_id, container_name, service_name,
      method, url, host, path,
      response_status, duration_ms,
      request_timestamp as timestamp,
      is_ai_request, api_type, api_version,
      client_ip, user_agent,
      request_size, response_size,
      error_message, retry_count, is_cached_response,
      conversation_id, user_id, session_id
    FROM http_traffic_logs
    WHERE id = 12
    LIMIT 1
  `);

  console.log('Raw query result:');
  console.log(JSON.stringify(rows[0], null, 2));

  // 处理Date对象 (模拟executeQuery的行为)
  const processed = { ...rows[0] };
  Object.keys(processed).forEach(key => {
    console.log(`${key}: ${typeof processed[key]} = ${processed[key]}`);
    if (processed[key] instanceof Date) {
      processed[key] = processed[key].toISOString();
    }
  });

  console.log('\nProcessed result:');
  console.log(JSON.stringify(processed, null, 2));

  await connection.end();
})();
