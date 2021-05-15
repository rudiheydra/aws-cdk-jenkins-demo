import * as cdk from '@aws-cdk/core';
import {Duration, RemovalPolicy} from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ec2 from '@aws-cdk/aws-ec2';
import {Port} from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as route53 from '@aws-cdk/aws-route53';
import {HostedZone} from '@aws-cdk/aws-route53';
import * as ecrDeploy from 'cdk-ecr-deployment'
import * as path from 'path';
import {DockerImageAsset} from '@aws-cdk/aws-ecr-assets';
import {PolicyStatement, Role, ServicePrincipal} from "@aws-cdk/aws-iam";

export class JenkinsKanikoStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'jenkins-vpc', {
            cidr: "10.0.0.0/16"
        })

        const cluster = new ecs.Cluster(this, 'jenkins-cluster', {
            vpc,
            clusterName: 'jenkins-cluster'
        });

        const jenkinsFileSystem = new efs.FileSystem(this, 'JenkinsFileSystem', {
            vpc: vpc,
            removalPolicy: RemovalPolicy.DESTROY
        });

        const jenkinsAccessPoint = jenkinsFileSystem.addAccessPoint('AccessPoint', {
            path: '/jenkins-home',
            posixUser: {
                uid: '1000',
                gid: '1000',
            },
            createAcl: {
                ownerGid: '1000',
                ownerUid: '1000',
                permissions: '755'
            }
        });

        const jenkinsTaskRole = new Role(this, 'JenkinsTaskRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
        });

        jenkinsTaskRole.addToPolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'ecs:RunTask'
            ],
        }));
        jenkinsTaskRole.addToPolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'iam:PassRole'
            ],
        }));

        const jenkinsTaskDefinition = new ecs.FargateTaskDefinition(this, 'jenkins-task-definition', {
            memoryLimitMiB: 1024,
            cpu: 512,
            family: 'jenkins',
            taskRole: jenkinsTaskRole
        });

        jenkinsTaskDefinition.addVolume({
            name: 'jenkins-home',
            efsVolumeConfiguration: {
                fileSystemId: jenkinsFileSystem.fileSystemId,
                transitEncryption: 'ENABLED',
                authorizationConfig: {
                    accessPointId: jenkinsAccessPoint.accessPointId,
                    iam: 'ENABLED'
                }
            }
        });

        const jenkinsContainerDefinition = jenkinsTaskDefinition.addContainer('jenkins', {
            image: ecs.ContainerImage.fromRegistry("tkgregory/jenkins-with-aws:latest"),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'jenkins'}),
            portMappings: [{
                containerPort: 8080
            }]
        });
        jenkinsContainerDefinition.addMountPoints({
            containerPath: '/var/jenkins_home',
            sourceVolume: 'jenkins-home',
            readOnly: false
        });

        const jenkinsService = new ecs.FargateService(this, 'JenkinsService', {
            cluster,
            taskDefinition: jenkinsTaskDefinition,
            desiredCount: 1,
            maxHealthyPercent: 100,
            minHealthyPercent: 0,
            healthCheckGracePeriod: Duration.minutes(5)
        });
        jenkinsService.connections.allowTo(jenkinsFileSystem, Port.tcp(2049));

        let certificateArn = this.node.tryGetContext('certificateArn');
        if (certificateArn) {
            const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {vpc, internetFacing: true});
            new cdk.CfnOutput(this, 'LoadBalancerDNSName', {value: loadBalancer.loadBalancerDnsName});

            const listener = loadBalancer.addListener('Listener', {
                port: 443,
                certificateArns: [certificateArn]
            });
            listener.addTargets('JenkinsTarget', {
                port: 8080,
                targets: [jenkinsService],
                deregistrationDelay: Duration.seconds(10),
                healthCheck: {
                    path: '/login'
                }
            });

            const hostedZoneName = this.node.tryGetContext('hostedZoneName')
            if (hostedZoneName) {
                const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
                    domainName: hostedZoneName
                });
                new route53.CnameRecord(this, 'CnameRecord', {
                    zone: hostedZone,
                    recordName: 'jenkins',
                    domainName: loadBalancer.loadBalancerDnsName,
                    ttl: Duration.minutes(1)
                });
            }
        }

        const kanikoBuilderRepository = new ecr.Repository(this, 'KanikoBuilderRepository', {
            repositoryName: 'kaniko-builder',
            removalPolicy: RemovalPolicy.DESTROY
        });

        const kanikoBuilderDockerImage = new DockerImageAsset(this, 'KanikoBuilderDockerImage', {
            directory: path.join(__dirname, 'kaniko-builder'),
        });

        new ecrDeploy.ECRDeployment(this, 'DeployKanikoBuilderDockerImage', {
            src: new ecrDeploy.DockerImageName(kanikoBuilderDockerImage.imageUri),
            dest: new ecrDeploy.DockerImageName(`${kanikoBuilderRepository.repositoryUri}:latest`)
        });

        const kanikoDemoRepository = new ecr.Repository(this, 'KanikoDemoRepository', {
            repositoryName: 'kaniko-demo',
            removalPolicy: RemovalPolicy.DESTROY
        });

        const kanikoRole = new Role(this, 'KanikoECSRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
        });

        kanikoRole.addToPolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:InitiateLayerUpload',
                'ecr:UploadLayerPart',
                'ecr:CompleteLayerUpload',
                'ecr:PutImage',
                'ecr:BatchGetImage',
                'ecr:BatchCheckLayerAvailability'
            ],
        }));

        const kanikoTaskDefinition = new ecs.FargateTaskDefinition(this, 'kaniko-task-definition', {
            memoryLimitMiB: 1024,
            cpu: 512,
            family: 'kaniko-builder',
            taskRole: kanikoRole
        });
        kanikoTaskDefinition.addToExecutionRolePolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage'
            ]
        }));

        kanikoTaskDefinition.addContainer('kaniko', {
            image: ecs.ContainerImage.fromRegistry(`${kanikoBuilderRepository.repositoryUri}:latest`),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'kaniko'}),
            command: [
                '--context', 'git://github.com/ollypom/mysfits.git',
                '--context-sub-path', './api',
                '--dockerfile', 'Dockerfile.v3',
                '--destination', `${kanikoDemoRepository.repositoryUri}:latest`,
                '--force'
            ]
        });

        const kanikoSecurityGroup = new ec2.SecurityGroup(this, 'KanikoSecurityGroup', {
            securityGroupName: 'kaniko-security-group',
            vpc: vpc
        });
        new cdk.CfnOutput(this, 'KanikoSecurityGroupId', {value: kanikoSecurityGroup.securityGroupId});
        new cdk.CfnOutput(this, 'PublicSubnetId', {value: vpc.publicSubnets[0].subnetId});
        new cdk.CfnOutput(this, 'PrivateSubnetId', {value: vpc.privateSubnets[0].subnetId});
    }
}
