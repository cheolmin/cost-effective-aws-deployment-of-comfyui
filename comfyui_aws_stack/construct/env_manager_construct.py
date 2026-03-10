"""
Environment Manager Construct
Provides Lambda functions and API endpoints for managing ComfyUI environments.
"""

from aws_cdk import (
    aws_lambda as lambda_,
    aws_iam as iam,
    aws_efs as efs,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ssm as ssm,
    aws_elasticloadbalancingv2 as elbv2,
    aws_elasticloadbalancingv2_targets as targets,
    Duration,
    RemovalPolicy,
)
from constructs import Construct
from cdk_nag import NagSuppressions
import os


class EnvManagerConstruct(Construct):
    """Construct for environment management Lambda and API endpoints."""

    lambda_function: lambda_.Function
    lambda_target_group: elbv2.ApplicationTargetGroup

    def __init__(
            self,
            scope: Construct,
            construct_id: str,
            vpc: ec2.Vpc,
            file_system: efs.FileSystem,
            access_point: efs.AccessPoint,
            efs_security_group: ec2.SecurityGroup,
            cluster: ecs.Cluster,
            service: ecs.IService,
            **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Create SSM Parameter for current environment
        current_env_param = ssm.StringParameter(
            self, "CurrentEnvironmentParam",
            parameter_name="/comfyui/current-environment",
            string_value="default",
            description="Current active ComfyUI environment"
        )

        # Create Lambda Security Group
        lambda_security_group = ec2.SecurityGroup(
            self, "EnvManagerLambdaSG",
            vpc=vpc,
            description="Security Group for Environment Manager Lambda",
            allow_all_outbound=True,
        )

        # Allow Lambda to access EFS
        efs_security_group.add_ingress_rule(
            ec2.Peer.security_group_id(lambda_security_group.security_group_id),
            ec2.Port.tcp(2049),
            "Allow Lambda to access EFS"
        )

        # Create Lambda execution role
        lambda_role = iam.Role(
            self, "EnvManagerLambdaRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaVPCAccessExecutionRole"
                ),
            ],
        )

        # Add permissions for ECS and SSM
        lambda_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "ecs:UpdateService",
                "ecs:DescribeServices",
            ],
            resources=["*"]
        ))

        lambda_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "ssm:GetParameter",
                "ssm:PutParameter",
            ],
            resources=[current_env_param.parameter_arn]
        ))

        # Grant EFS access
        file_system.grant_read_write(lambda_role)

        # Create Lambda function
        lambda_function = lambda_.Function(
            self, "EnvManagerFunction",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="environment_manager.handler",
            code=lambda_.Code.from_asset(
                os.path.join(os.path.dirname(__file__), "..", "lambda", "env_manager_lambda")
            ),
            timeout=Duration.seconds(30),
            memory_size=256,
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
            security_groups=[lambda_security_group],
            filesystem=lambda_.FileSystem.from_efs_access_point(
                access_point,
                "/mnt/efs"
            ),
            environment={
                "EFS_MOUNT_PATH": "/mnt/efs",
                "ECS_CLUSTER_NAME": cluster.cluster_name,
                "ECS_SERVICE_NAME": service.service_name,
            },
            role=lambda_role,
        )

        # Create Target Group for ALB integration
        lambda_target_group = elbv2.ApplicationTargetGroup(
            self, "EnvManagerTargetGroup",
            targets=[targets.LambdaTarget(lambda_function)],
            health_check=elbv2.HealthCheck(
                enabled=False,  # Lambda targets don't support health checks
            )
        )

        # CDK Nag Suppressions
        NagSuppressions.add_resource_suppressions(
            [lambda_role],
            suppressions=[
                {"id": "AwsSolutions-IAM4",
                 "reason": "Using managed policy for Lambda VPC access is standard practice."
                 },
                {"id": "AwsSolutions-IAM5",
                 "reason": "ECS UpdateService needs wildcard for service ARN pattern."
                 },
            ],
            apply_to_children=True
        )

        NagSuppressions.add_resource_suppressions(
            [lambda_function],
            suppressions=[
                {"id": "AwsSolutions-L1",
                 "reason": "Using Python 3.12 which is current stable version."
                 },
            ],
        )

        # Outputs
        self.lambda_function = lambda_function
        self.lambda_target_group = lambda_target_group
        self.current_env_param = current_env_param
