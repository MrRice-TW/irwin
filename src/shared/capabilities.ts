export function capabilities(provider: "mongodb" | "cosmos", version: string) {
  const cosmos = provider === "cosmos";
  return {
    conditionalEditing: !cosmos || /^7\./.test(version),
    conditionalEditingReason:
      cosmos && !/^7\./.test(version)
        ? "Conditional editing is configured for Cosmos MongoDB API 7.0 only; the server version could not be confirmed as 7.0."
        : "",
    createCollection: !cosmos,
    createCollectionReason: cosmos
      ? "Configure Cosmos partition keys and throughput in Azure before creating collections."
      : "",
    bsonTransfer: !cosmos,
    bsonTransferReason: cosmos
      ? "BSON restore combinations are not yet verified for Cosmos RU. Use Extended JSON."
      : "",
  };
}

export function databaseError(error: any) {
  if (error?.code === 16500 || error?.code === 429)
    return "Cosmos RU throttled this request. Wait for capacity or adjust RU before retrying. Completed writes remain; an unknown write result must be refreshed first.";
  if ([115, 59, 40324].includes(error?.code))
    return `The connected service does not support this command or option: ${error.message}`;
  return String(error?.message || error);
}
