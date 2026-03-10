from aws_cdk import (
    aws_efs as efs,
    aws_ec2 as ec2,
    RemovalPolicy,
    CfnOutput,
)
from constructs import Construct
from cdk_nag import NagSuppressions


class EfsConstruct(Construct):
    """EFS construct for ComfyUI environment data storage."""

    file_system: efs.FileSystem
    access_point: efs.AccessPoint

    def __init__(
            self,
            scope: Construct,
            construct_id: str,
            vpc: ec2.Vpc,
            **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Create Security Group for EFS
        efs_security_group = ec2.SecurityGroup(
            self, "EfsSecurityGroup",
            vpc=vpc,
            description="Security Group for EFS",
            allow_all_outbound=True,
        )

        # Allow NFS traffic from within VPC
        efs_security_group.add_ingress_rule(
            ec2.Peer.ipv4(vpc.vpc_cidr_block),
            ec2.Port.tcp(2049),
            "Allow NFS traffic from VPC"
        )

        # Create EFS File System
        file_system = efs.FileSystem(
            self, "ComfyUIEnvFileSystem",
            vpc=vpc,
            lifecycle_policy=efs.LifecyclePolicy.AFTER_30_DAYS,
            performance_mode=efs.PerformanceMode.GENERAL_PURPOSE,
            throughput_mode=efs.ThroughputMode.BURSTING,
            removal_policy=RemovalPolicy.RETAIN,
            security_group=efs_security_group,
            encrypted=True,
        )

        # Create Access Point for environments directory
        access_point = efs.AccessPoint(
            self, "ComfyUIEnvAccessPoint",
            file_system=file_system,
            path="/comfyui-environments",
            create_acl=efs.Acl(
                owner_uid="1000",
                owner_gid="1000",
                permissions="755"
            ),
            posix_user=efs.PosixUser(
                uid="1000",
                gid="1000"
            )
        )

        # CDK Nag Suppressions
        NagSuppressions.add_resource_suppressions(
            [file_system],
            suppressions=[
                {"id": "AwsSolutions-EFS1",
                 "reason": "EFS encryption is enabled with default KMS key for sample purposes."
                 },
            ],
        )

        # Outputs
        self.file_system = file_system
        self.access_point = access_point
        self.security_group = efs_security_group
