import { Box, Text, Title as MantineTitle } from "@mantine/core";
import { ITitleProps } from "../../types/components/type";

function Title({ title, description }: ITitleProps) {
    return (
        <Box mb={26}>
            <MantineTitle order={1} fz={30} lh={1.15}>{title}</MantineTitle>
            <Text c="dimmed" mt={6} fz={14.5}>{description}</Text>
        </Box>
    );
}

export default Title;
