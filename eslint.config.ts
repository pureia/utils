import useConfig from '@purea/eslint-config';

export default useConfig({
  ignores: ['.scratch/**'], // 本地 issue/评审 ticket 产物（含代码片段），不参与 lint
});
