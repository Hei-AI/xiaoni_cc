import express from 'express';
import axios, { AxiosError } from 'axios';
import winston from 'winston';

export function createFunctionRegistryRoutes(
  baseUrl: string,
  logger: winston.Logger
) {
  const router = express.Router();
  const http = axios.create({
    baseURL: baseUrl,
    timeout: 5000
  });

  router.get('/functions', async (req, res) => {
    try {
      const response = await http.get('/functions', {
        params: req.query
      });
      res.json(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to fetch function list from registry', {
        error: axiosError.message,
        url: `${baseUrl}/functions`
      });
      res.status(axiosError.response?.status || 500).json({
        success: false,
        error: axiosError.message,
        data: axiosError.response?.data
      });
    }
  });

  router.get('/prompts/:id', async (req, res) => {
    try {
      const response = await http.get(`/prompts/${req.params.id}/functions`);
      res.json(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to fetch prompt function bindings', {
        promptId: req.params.id,
        error: axiosError.message
      });
      res.status(axiosError.response?.status || 500).json({
        success: false,
        error: axiosError.message,
        data: axiosError.response?.data
      });
    }
  });

  router.patch('/prompts/:id', async (req, res) => {
    try {
      const response = await http.patch(`/prompts/${req.params.id}/functions`, req.body);
      res.json(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to update prompt function bindings', {
        promptId: req.params.id,
        error: axiosError.message
      });
      res.status(axiosError.response?.status || 500).json({
        success: false,
        error: axiosError.message,
        data: axiosError.response?.data
      });
    }
  });

  return router;
}
