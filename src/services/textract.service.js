import { AnalyzeExpenseCommand, TextractClient } from '@aws-sdk/client-textract';
import { logger } from '../utils/logger.js';

export const textractClient = new TextractClient({
  region: process.env.AWS_REGION || process.env.AWS_REGION_NAME || 'ap-southeast-1'
});

/**
 * Runs Textract AnalyzeExpense against a private S3 invoice object.
 * Only the object key is logged; credentials and signed URLs are never logged.
 */
export const extractInvoiceData = async (bucketName, fileKey) => {
  const command = new AnalyzeExpenseCommand({
    Document: {
      S3Object: {
        Bucket: bucketName,
        Name: fileKey
      }
    }
  });

  try {
    logger.info('Calling Textract AnalyzeExpense', { fileKey });
    const textractResponse = await textractClient.send(command);
    const expenseDocuments = textractResponse.ExpenseDocuments || [];
    logger.info('Textract AnalyzeExpense returned', {
      fileKey,
      expenseDocumentsCount: expenseDocuments.length
    });
    return expenseDocuments;
  } catch (error) {
    logger.error('Textract AnalyzeExpense failed', error, { fileKey });
    throw error;
  }
};
