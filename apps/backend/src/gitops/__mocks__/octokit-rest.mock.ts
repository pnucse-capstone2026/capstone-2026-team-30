export class Octokit {
  rest = {
    issues: {
      createComment: jest.fn().mockResolvedValue({
        data: {
          html_url: "https://github.com/org/repo/pull/42#issuecomment-1",
        },
      }),
    },
    repos: {
      createCommitStatus: jest.fn().mockResolvedValue({ data: {} }),
    },
  };
}
