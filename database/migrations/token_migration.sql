-- 将token.properties中的Token导入到api_tokens表

INSERT INTO api_tokens (
  token, 
  project_name, 
  project_id, 
  is_active, 
  is_healthy, 
  daily_limit, 
  daily_used, 
  total_used, 
  priority, 
  weight
) VALUES 
('AIzaSyAQAQMc5KF3srzOtwGyj6QmRS5oM1IYdNE', 'Gemini-Project-1', '502422130164', true, true, 1000, 0, 0, 1, 1.00),
('AIzaSyBBhrk0pmJwCbVYsZZoQA_9y14AgZv9aB8', 'Gemini-Project-2', '880710386052', true, true, 1000, 0, 0, 2, 1.00),
('AIzaSyCxjt4DS6OK799BCnZ79qX6K-7xv-D1rvI', 'Gemini-Project-3', '928592136713', true, true, 1000, 0, 0, 3, 1.00),
('AIzaSyDuNbx_ENLH8Ih5EKRPqxbY3OnvACyJx8A', 'Gemini-Project-4', '884687838082', true, true, 1000, 0, 0, 4, 1.00),
('AIzaSyDb7zuLhcMeR1x6XGSoOsrmuvo6WD5Hslc', 'Gemini-Project-5', '473474642118', true, true, 1000, 0, 0, 5, 1.00),
('AIzaSyDrYA1hVdu3QoEX70vJJ_j3CVG7EuvmLPQ', 'Gemini-Project-6', '11393514745', true, true, 1000, 0, 0, 6, 1.00),
('AIzaSyB1IM6ibwBks24aRT8YDfPFYubuciFmxEc', 'Gemini-Project-7', '103513478806', true, true, 1000, 0, 0, 7, 1.00),
('AIzaSyCRlZfLcNhlENgEgvNdbh1D-mn-1-w3JMo', 'Gemini-Project-8', '531701050439', true, true, 1000, 0, 0, 8, 1.00),
('AIzaSyCM94IW2Wv9tDh6VkqdLP8WxqNDUqXD0PU', 'Gemini-Project-9', '581322877443', true, true, 1000, 0, 0, 9, 1.00),
('AIzaSyA1Nzf3K5GYeh5YZcZhN68E7IafvKcRLl0', 'Gemini-Project-10', '1021491103010', true, true, 1000, 0, 0, 10, 1.00)
ON DUPLICATE KEY UPDATE 
  project_name = VALUES(project_name),
  project_id = VALUES(project_id),
  updated_at = CURRENT_TIMESTAMP;
