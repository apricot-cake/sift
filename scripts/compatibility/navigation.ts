/** ページ取得前の一時的な名前解決失敗だけを1回再試行する。 */
export async function retryNameResolution<T>(
  navigate: () => Promise<T>,
  record: (message: string) => Promise<void>,
): Promise<T> {
  try {
    return await navigate();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("net::ERR_NAME_NOT_RESOLVED")
    )
      throw error;
    await record(error.message);
    return navigate();
  }
}
