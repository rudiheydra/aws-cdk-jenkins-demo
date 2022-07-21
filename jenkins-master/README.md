
![Capture](https://user-images.githubusercontent.com/53549619/180184367-29832c91-208c-45b6-b499-6e65668a8956.PNG)

![Capture2](https://user-images.githubusercontent.com/53549619/180184390-06217e43-dd56-4fc2-b91b-1e4338dadb74.PNG)

![Capture3](https://user-images.githubusercontent.com/53549619/180184420-f2dd6ae3-d750-49e9-ba72-f784e71783bd.PNG)

# jenkins-master with CDK by [Tom Gregory](https://tomgregory.com/deploying-jenkins-into-aws-ecs-using-cdk/)

Sample Jenkins implementation in CDK, including:

* VPC, subnets, load balancer, and other network setup
* Jenkins deployment to ECS using serverless Fargate containers
* single master, with automatic failover to 2nd availability zone
* persistent storage with EFS
* secure access over HTTPS, with optional registration into a hosted zone

## Deploying

Install required npm packages:

`npm install`

Ensure you have the following environment variables set:
* `CDK_DEFAULT_ACCOUNT=<your-aws-account-id>`
* `CDK_DEFAULT_REGION=<aws-region>`

Decide what values (if any) you want to pass for these optional context parameters.

* **certificateArn** is the ARN of a Certificate Manager certificate to be attached to the load balancer listener.
  If this isn't provided you won't be able to access your Jenkins instance.
* **hostedZoneName** is the name of a Route 53 hosted zone into which a `jenkins` CNAME record will be added e.g. set
to `tomgregory.com` to register a CNAME record `jenkins.tomgregory.com` pointing at the load balancer DNS record

Then run this command:

`cdk deploy --context certificateArn=<certificate-arn> --context hostedZoneName=<hosted-zone-name>`

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
 * `cdk destroy`     deletes this stack    
