# CLI tool for deleting orphaned Lambda@Edge functions

![GitHub License](https://img.shields.io/github/license/dangreaves/lambda-edge-cleaner)

This CLI tool uses the AWS SDK to delete [Lambda@Edge](https://aws.amazon.com/lambda/edge) functions in the `us-east-1` region which are no longer attached to a CloudFront distribution.

## Motivation

Lambda@Edge functions must be created in the `us-east-1` region.

These functions are associated with CloudFront behaviors which when triggered, create _replicas_ of the function in the region they are needed.

So you end up with the "primary" function in `us-east-1`, and a bunch of replicas copied to the various regions your users are in.

The AWS CDK provides an [EdgeFunction](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.experimental.EdgeFunction.html) construct, for creating Lambda@Edge functions in the `us-east-1` region, regardless of the region your stack is deployed to.

This construct creates a CloudFormation stack in `us-east-1` with a name like `edge-lambda-stack-c8199afd943f2b89b6c86ef96a5296c9c8adc0003b`.

When you disassociate the function from your CloudFront distribution (e.g. you delete the distribution, or the cache behavior), the associated edge function stack in `us-east-1` is not deleted.

This is because the stack can only be deleted when all the replicas have been deleted, which happens automatically ["a few hours"](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html) after the function is no longer associated with a CloudFront behavior.

This means you end up with orphaned edge function stacks in your `us-east-1` region, which never get deleted, despite not being associated with any distributions.

## Usage

> [!CAUTION]
> This script will delete CloudFormation stacks without warning.
>
> - Use of this script is at your own risk.
> - You may need to adapt it for your specific use case.
> - It has no CLI interface or fancy features to protect you.
> - Carefully review the contents of [src/commands/delete-fns.ts](./src/commands/delete-fns.ts) before running this script.

```sh
npm install
npm start -- delete-fns
```

## How does it work?

> [!WARNING]
> This script assumes all your CloudFront distributions are in your CLI region.
>
> If you have distributions in other regions, then it will falsely assume those functions are unattached and try to delete them.
>
> The stack deletion will fail, because the edge function is still attached to a CloudFront distribution.

The script works with the following steps.

1. Fetches all Lambda functions deployed to the `us-east-1` region, and filters those functions where the ARN contains `edge-lambda` (this is the format which the [EdgeFunction](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.experimental.EdgeFunction.html) construct uses).
2. Fetches all CloudFront distributions in your CLI region, and extracts a list of attached Lambda@Edge function ARNs.
3. Calculates a list of unattached Lambda@Edge function ARNs by comparing the two lists.
4. Fetches all CloudFormation stacks in the `us-east-1` region.
5. For each unattached Lambda@Edge function ARN, try to find a matching CloudFormation stack (they share parts of the name).
6. If a CloudFormation stack is found, delete it.
