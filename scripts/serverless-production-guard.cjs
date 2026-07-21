'use strict';

class FinVantageProductionGuard {
  constructor(serverless, options = {}) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:package:initialize': () => this.validateAndConfigure(),
      'before:package:createDeploymentArtifacts': () => this.validateAndConfigure(),
      'before:deploy:deploy': () => this.validateAndConfigure(),
      'before:deploy:function:initialize': () => this.validateAndConfigure(),
      'before:deploy:function:packageFunction': () => this.validateAndConfigure(),
      'before:offline:start:init': () => this.validateAndConfigure(),
      'before:print:print': () => this.validateAndConfigure()
    };
  }

  async validateAndConfigure() {
    const stage = this.options.stage || this.serverless.service.provider.stage || 'dev';
    const { assertProductionConfig, isProductionEnvironment, parseCsvEnvironment } = await import('../src/config/production.config.js');
    assertProductionConfig(process.env, { stage });

    if (!isProductionEnvironment(process.env, stage)) return;
    this.serverless.service.provider.vpc = {
      subnetIds: parseCsvEnvironment(process.env.PRIVATE_SUBNET_IDS),
      securityGroupIds: parseCsvEnvironment(process.env.LAMBDA_SECURITY_GROUP_IDS)
    };
  }
}

module.exports = FinVantageProductionGuard;
