import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({
  region: process.env.AWS_REGION || process.env.AWS_REGION_NAME || 'ap-southeast-1',
});

export const publishBudgetAlert = async (userId, alert) => {
  const topicArn = process.env.SNS_BUDGET_ALERTS_TOPIC_ARN;
  if (!topicArn || !alert) return { skipped: true };

  await snsClient.send(new PublishCommand({
    TopicArn: topicArn,
    Subject: `FinVantage budget alert: ${alert.category}`.slice(0, 100),
    Message: JSON.stringify({
      type: 'BUDGET_THRESHOLD_REACHED',
      userId,
      email: alert.email,
      displayName: alert.display_name,
      category: alert.category,
      spent: alert.spent,
      budgetAmount: alert.budget_amount,
      percent: Math.round((alert.spent / alert.budget_amount) * 100),
    }),
    MessageAttributes: {
      userId: { DataType: 'String', StringValue: JSON.stringify(userId) },
      email: { DataType: 'String', StringValue: JSON.stringify(alert.email) },
      eventType: { DataType: 'String', StringValue: JSON.stringify('BUDGET_THRESHOLD_REACHED') },
    },
  }));
  return { published: true };
};
