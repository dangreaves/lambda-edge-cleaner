import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";

import {
  ListStacksCommand,
  type StackSummary,
  DeleteStackCommand,
  CloudFormationClient,
} from "@aws-sdk/client-cloudformation";

import {
  CloudFrontClient,
  ListDistributionsCommand,
} from "@aws-sdk/client-cloudfront";

const lambda = new LambdaClient({
  region: "us-east-1",
});

const cloudformation = new CloudFormationClient({ region: "us-east-1" });

const cloudfront = new CloudFrontClient();

/**
 * Delete orphaned Lambda@Edge functions.
 */
export async function deleteFns() {
  // Fetch Lambda@Edge functions from us-east-1 region.
  const edgeFns = await listEdgeFunctions();
  console.log(`Found ${edgeFns.length} edge functions.`);

  // Fetch a list of attached Lambda@Edge function ARNs by inspecting CloudFront deployments.
  const attachedFunctions = await listAttachedFunctions();
  console.log(`Found ${attachedFunctions.length} attached functions.`);

  // Calculate which functions are unattached by comparing the ARN lists.
  const unattachedFunctions = edgeFns.filter(
    (arn) => !attachedFunctions.includes(arn),
  );
  console.log(`Calculated ${unattachedFunctions.length} unattached functions.`);

  // Fetch CloudFormation stacks from us-east-1 region.
  const stacks = await listStacks();

  // For each unattached function ARN, try to find the corresponding CloudFormation stack
  // and delete it.
  let deletedStackCount = 0;
  for (const unattachedFunction of unattachedFunctions) {
    const stackSearch = unattachedFunction.match(/edge-lambda-stack-\w+/);

    if (!stackSearch) {
      console.warn(`Could not resolve stack ID from ${unattachedFunction}.`);
      continue;
    }

    const stackIdSearch = stackSearch[0];

    const stack = stacks.find(
      (stack) => stack.StackId?.includes(stackIdSearch),
    );

    if (!stack) {
      console.warn(
        `Could not resolve stack for ${unattachedFunction} (stack ID search ${stackIdSearch}).`,
      );
      continue;
    }

    await cloudformation.send(
      new DeleteStackCommand({ StackName: stack.StackName }),
    );

    deletedStackCount++;
  }
  console.log(
    `Deleted ${deletedStackCount} stacks with unattached edge functions.`,
  );
}

/**
 * Recursively fetch a list of attached Lambda@Edge function ARNs by inspecting the cache behaviors
 * of CloudFront distributions.
 */
async function listAttachedFunctions(
  attachedFunctions: string[] = [],
  Marker?: string,
): Promise<string[]> {
  const command = new ListDistributionsCommand({ Marker });

  const response = await cloudfront.send(command);

  if (!response.DistributionList?.Items) return attachedFunctions;

  for (const distribution of response.DistributionList.Items) {
    // Combine cache behaviors
    const cacheBehaviors = [
      ...(distribution.DefaultCacheBehavior
        ? [distribution.DefaultCacheBehavior]
        : []),
      ...(distribution.CacheBehaviors?.Items ?? []),
    ];

    // Loop cache behaviors and append attached functions.
    for (const cacheBehavior of cacheBehaviors) {
      if (!cacheBehavior.LambdaFunctionAssociations?.Items) continue;
      for (const functionAssociation of cacheBehavior.LambdaFunctionAssociations
        .Items) {
        if (functionAssociation.LambdaFunctionARN) {
          attachedFunctions.push(
            // Remove the version number from the end.
            functionAssociation.LambdaFunctionARN.replace(/:\d+$/, ""),
          );
        }
      }
    }
  }

  if (!response.DistributionList.NextMarker) return attachedFunctions;

  return await listAttachedFunctions(
    attachedFunctions,
    response.DistributionList.NextMarker,
  );
}

/**
 * Recursively fetch CloudFormation stacks.
 */
async function listStacks(
  stacks: StackSummary[] = [],
  NextToken?: string,
): Promise<StackSummary[]> {
  const command = new ListStacksCommand({ NextToken });

  const response = await cloudformation.send(command);

  stacks = [...stacks, ...(response.StackSummaries ?? [])];

  if (!response.NextToken) return stacks;

  return await listStacks(stacks, response.NextToken);
}

/**
 * Recursively fetch Lambda@Edge function ARNs.
 *
 * A Lambda@Edge function is identified by the presence of "edge-lambda" in the ARN, which is
 * the naming convention that the CDK EdgeFunction construct uses.
 */
async function listEdgeFunctions(
  edgeFns: string[] = [],
  Marker?: string,
): Promise<string[]> {
  const command = new ListFunctionsCommand({ Marker });

  const response = await lambda.send(command);

  if (!response.Functions) return edgeFns;

  for (const lambdaFn of response.Functions) {
    if (!lambdaFn.FunctionArn) continue;
    if (!lambdaFn.FunctionArn.includes("edge-lambda")) continue;
    edgeFns.push(lambdaFn.FunctionArn);
  }

  if (!response.NextMarker) return edgeFns;

  return await listEdgeFunctions(edgeFns, response.NextMarker);
}
