# Install SageMath

The default Codespace image does not include SageMath, which is only needed if you plan to include sageplot images. You can install it by clicking the button on the left or by running the following command in the terminal:

```bash
bash ./.devcontainer/installSage.sh
```

If you don't want to run these every time you create a new codespace for this project, edit the `.devcontainer` file.  Look for the line that starts with
`postCreateCommand` and uncomment the lines for each of those scripts as you like.

Note: the button on the left does both these tasks for you.
